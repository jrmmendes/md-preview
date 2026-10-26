/**
 * Parser and server-side renderer for ```tree fences.
 *
 * The input is the plain text output of the `tree` command (optionally with
 * `-a` or `-d`). Parsing is deliberately conservative: anything that does not
 * look like a tree returns `null`, so the Markdown renderer can fall back to a
 * regular code block instead of breaking the page.
 */

export interface TreeFooter {
  /** `null` when the footer only reports a file count. */
  directories: number | null;
  /** `null` when the footer only reports a directory count. */
  files: number | null;
}

export interface TreeNode {
  name: string;
  depth: number;
  directory: boolean;
  children: TreeNode[];
  /** Total number of descendants (directories and files). */
  count: number;
}

export interface ParsedTree {
  root: TreeNode;
  footer: TreeFooter | null;
}

export interface TreeRenderOptions {
  /** Treat every entry as a directory (`tree -d` without a report footer). */
  dirsOnly?: boolean;
}

/** Directories at or above this depth start expanded (root + first level). */
const INITIAL_OPEN_DEPTH = 1;

/** Guard against pathological input that would exhaust the render stack. */
const MAX_DEPTH = 64;

const ANSI_RE = /\u001b\[[0-9;]*m/g;

/**
 * Whitespace accepted for indentation. Besides a normal space this covers the
 * no-break variants (U+00A0, U+2007, U+202F) that show up when tree output is
 * copied from a rendered page or a terminal that substitutes them.
 */
const SPACE_CHAR = "[ \\u00a0\\u2007\\u202f]";

/**
 * One indentation unit is four columns: either a vertical guide plus three
 * spaces, or four spaces. Connectors accept the usual Unicode tree glyphs, the
 * classic ASCII variants and the Windows `├───` / `└───` form.
 */
const INDENT_UNIT = `(?:[│|]${SPACE_CHAR}{3}|${SPACE_CHAR}{4})`;

const CONNECTOR_RE = new RegExp(
  `^(?<prefix>(?:${INDENT_UNIT})*)(?<connector>├─{2,3}|└─{2,3}|├─|└─|\\|-{2,3}|\`-{2,3}|\\+-{2,3})${SPACE_CHAR}?(?<name>.+)$`
);

/**
 * Report footer printed by `tree`. Every part is optional except that at least
 * one count must be present:
 *   - `N directories, M files`
 *   - `N directories`
 *   - `M files`
 * The trailing `K links` part (when `-l` is used) is ignored.
 */
const FOOTER_RE =
  /^(?:(\d+)\s+director(?:y|ies)(?:,\s*(\d+)\s+files?)?(?:,\s*\d+\s+links?)?|(\d+)\s+files?(?:,\s*\d+\s+links?)?)$/i;

const CHEVRON_ICON =
  '<svg class="mdprv-tree-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M6 3.5 10.5 8 6 12.5"></path></svg>';

const CHEVRON_SPACER = '<span class="mdprv-tree-chevron-spacer" aria-hidden="true"></span>';

const FOLDER_ICON =
  '<svg class="mdprv-tree-icon mdprv-tree-icon--dir" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M1.75 3.25h4l1.5 1.75h7v7.75h-12.5z"></path><path d="M1.75 6h12.5"></path></svg>';

const FILE_ICON =
  '<svg class="mdprv-tree-icon mdprv-tree-icon--file" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 1.75h5l3 3v9.5H4z"></path><path d="M9 1.75v3h3"></path></svg>';

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseFooter(line: string): TreeFooter | null {
  const match = FOOTER_RE.exec(line);
  if (!match) {
    return null;
  }
  const directories = match[1];
  const files = match[2];
  const filesOnly = match[3];
  if (directories !== undefined) {
    return {
      directories: Number(directories),
      files: files === undefined ? null : Number(files),
    };
  }
  if (filesOnly !== undefined) {
    return { directories: null, files: Number(filesOnly) };
  }
  return null;
}

/**
 * Remove indentation shared by every non-empty line. This keeps a fence that
 * was copied with an extra leading indent usable without changing the depth of
 * normal tree output (where the first line starts at column zero).
 */
function stripCommonIndent(lines: string[]): string[] {
  const leading = new RegExp(`^${SPACE_CHAR}*`);
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const match = leading.exec(line);
    const indent = match ? match[0].length : 0;
    if (indent < minimum) {
      minimum = indent;
    }
  }
  if (!Number.isFinite(minimum) || minimum === 0) {
    return lines;
  }
  return lines.map((line) => line.slice(Math.min(minimum, line.length)));
}

function finalize(node: TreeNode, allDirectories: boolean): number {
  let total = 0;
  for (const child of node.children) {
    total += 1 + finalize(child, allDirectories);
  }
  node.count = total;
  node.directory =
    node.depth === 0 || allDirectories || node.directory || node.children.length > 0;
  return total;
}

export function parseTree(source: string, options: TreeRenderOptions = {}): ParsedTree | null {
  const normalized = source.replace(/\r\n?/g, "\n").replace(ANSI_RE, "");
  const lines = stripCommonIndent(normalized.split("\n"));

  let root: TreeNode | null = null;
  const path: TreeNode[] = [];
  let footer: TreeFooter | null = null;
  let sawFooter = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (line.trim() === "") {
      continue;
    }
    if (sawFooter) {
      return null;
    }

    const footerMatch = parseFooter(line.trim());
    if (footerMatch) {
      if (!root) {
        return null;
      }
      footer = footerMatch;
      sawFooter = true;
      continue;
    }

    if (!root) {
      if (CONNECTOR_RE.test(line)) {
        return null;
      }
      const name = line.trim();
      if (name === "") {
        return null;
      }
      root = { name, depth: 0, directory: true, children: [], count: 0 };
      path.push(root);
      continue;
    }

    const match = CONNECTOR_RE.exec(line);
    if (!match || !match.groups) {
      return null;
    }
    const prefix = match.groups.prefix ?? "";
    const name = (match.groups.name ?? "").replace(/\s+$/, "");
    if (name === "" || prefix.length % 4 !== 0) {
      return null;
    }

    const depth = prefix.length / 4 + 1;
    if (depth > MAX_DEPTH || depth > path.length) {
      return null;
    }
    const parent = path[depth - 1];
    if (!parent) {
      return null;
    }

    const node: TreeNode = {
      name,
      depth,
      directory: name.endsWith("/"),
      children: [],
      count: 0,
    };
    path.length = depth;
    parent.children.push(node);
    path.push(node);
  }

  if (!root || root.children.length === 0) {
    return null;
  }

  const allDirectories =
    options.dirsOnly === true ||
    (footer !== null &&
      (footer.files === 0 || (footer.files === null && footer.directories !== null)));
  finalize(root, allDirectories);
  return { root, footer };
}

function formatCount(count: number): string {
  return count === 1 ? "1 item" : `${count} itens`;
}

function renderLeaf(node: TreeNode): string {
  const icon = node.directory ? FOLDER_ICON : FILE_ICON;
  return `<li class="mdprv-tree-item mdprv-tree-item--leaf"><div class="mdprv-tree-row mdprv-tree-row--leaf">${CHEVRON_SPACER}${icon}<span class="mdprv-tree-name">${escapeText(node.name)}</span></div></li>`;
}

function renderNode(node: TreeNode): string {
  if (!node.directory || node.children.length === 0) {
    return renderLeaf(node);
  }

  const open = node.depth <= INITIAL_OPEN_DEPTH;
  const count =
    node.count > 0 ? `<span class="mdprv-tree-count">${formatCount(node.count)}</span>` : "";
  const children = node.children.map(renderNode).join("");

  return `<li class="mdprv-tree-item mdprv-tree-item--dir"><details class="mdprv-tree-dir"${open ? " open" : ""}><summary class="mdprv-tree-row" role="button" aria-expanded="${open ? "true" : "false"}">${CHEVRON_ICON}${FOLDER_ICON}<span class="mdprv-tree-name">${escapeText(node.name)}</span>${count}</summary><ul class="mdprv-tree-group">${children}</ul></details></li>`;
}

function hasCollapsible(node: TreeNode): boolean {
  if (node.directory && node.children.length > 0) {
    return true;
  }
  return node.children.some(hasCollapsible);
}

/**
 * Render a `tree` fence body as HTML. Returns `null` when the body cannot be
 * recognized, which tells the caller to use the normal code block.
 */
export function renderTree(source: string, options: TreeRenderOptions = {}): string | null {
  const parsed = parseTree(source, options);
  if (!parsed) {
    return null;
  }

  const toolbar = hasCollapsible(parsed.root)
    ? '<div class="mdprv-tree-toolbar" data-mdprv-tree-toolbar hidden><button type="button" class="mdprv-tree-action" data-mdprv-tree-action="expand">Expandir tudo</button><button type="button" class="mdprv-tree-action" data-mdprv-tree-action="collapse">Recolher tudo</button></div>'
    : "";

  return `<div class="mdprv-tree" data-mdprv-tree role="group" aria-label="Árvore de diretórios">${toolbar}<ul class="mdprv-tree-list">${renderNode(parsed.root)}</ul></div>`;
}
