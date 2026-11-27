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
  /** Empty for a standalone comment row. */
  name: string;
  depth: number;
  directory: boolean;
  children: TreeNode[];
  /** Total number of descendants (directories and files). */
  count: number;
  /** Text after `#`; `null` when the entry has no comment. */
  comment: string | null;
  /**
   * True only for the synthetic `.` root created for indentation-only trees
   * with several top-level entries. It has no row of its own.
   */
  implicitRoot: boolean;
}

export interface ParsedTree {
  root: TreeNode;
  footer: TreeFooter | null;
}

export interface TreeRenderOptions {
  /** Treat every entry as a directory (`tree -d` without a report footer). */
  dirsOnly?: boolean;
  /**
   * Highlights the original fence body for the per-block "Raw" toggle. Called
   * only after the body is recognized as a tree, so invalid fences never pay
   * for highlighting. Returning an empty string disables the toggle.
   */
  renderSource?: (source: string) => string;
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

const LEADING_INDENT_RE = new RegExp(`^${SPACE_CHAR}*`);

/** Separator accepted before `#` in comments (indentation itself is spaces). */
const COMMENT_SPACE = `(?:${SPACE_CHAR}|\\t)`;

/**
 * Inline comment: `name   # texto`. The `#` only starts a comment when it is
 * preceded by whitespace and there is a non-empty name before it, so names
 * such as `file#1.ts` or `C#/` are left untouched.
 */
const INLINE_COMMENT_RE = new RegExp(
  `^(?<name>.+?)${COMMENT_SPACE}+#(?:${COMMENT_SPACE}+(?<comment>.*))?$`
);

/**
 * Standalone comment row: `# texto`. The `#` must be followed by whitespace (or
 * end the entry) so a file named `#nota` is still treated as a name.
 */
const COMMENT_ONLY_RE = new RegExp(`^#(?:${COMMENT_SPACE}+(?<comment>.*))?$`);

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
  '<span class="mdprv-icon mdprv-tree-chevron" data-icon="chevron" aria-hidden="true"></span>';

const CHEVRON_SPACER = '<span class="mdprv-tree-chevron-spacer" aria-hidden="true"></span>';

const FOLDER_ICON =
  '<span class="mdprv-icon mdprv-tree-icon mdprv-tree-icon--dir" data-icon="folder" aria-hidden="true"></span>';

const FILE_ICON =
  '<span class="mdprv-icon mdprv-tree-icon mdprv-tree-icon--file" data-icon="file" aria-hidden="true"></span>';

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
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() === "") {
      continue;
    }
    const match = LEADING_INDENT_RE.exec(line);
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

function makeRoot(value: string): TreeNode | null {
  const { name, comment } = splitComment(value);
  if (name === "") {
    return null;
  }
  return { name, depth: 0, directory: true, children: [], count: 0, comment, implicitRoot: false };
}

function finalize(node: TreeNode, allDirectories: boolean): number {
  let total = 0;
  for (const child of node.children) {
    if (isCommentNode(child)) {
      continue;
    }
    total += 1 + finalize(child, allDirectories);
  }
  node.count = total;
  if (!isCommentNode(node)) {
    const hasRealChildren = node.children.some((child) => !isCommentNode(child));
    node.directory =
      node.depth === 0 || allDirectories || node.directory || hasRealChildren;
  }
  return total;
}

/**
 * Split an entry into its name and optional comment. Inline comments require a
 * whitespace-separated `#` after a non-empty name; standalone rows require the
 * whole entry to start with `#` followed by whitespace (or nothing).
 */
function splitComment(value: string): { name: string; comment: string | null } {
  const standalone = COMMENT_ONLY_RE.exec(value.trim());
  if (standalone) {
    return { name: "", comment: standalone.groups?.comment ?? "" };
  }
  const inline = INLINE_COMMENT_RE.exec(value);
  if (inline?.groups) {
    const name = (inline.groups.name ?? "").replace(/\s+$/, "");
    if (name !== "") {
      return { name, comment: inline.groups.comment ?? "" };
    }
  }
  return { name: value.replace(/\s+$/, ""), comment: null };
}

function isCommentEntry(value: string): boolean {
  return COMMENT_ONLY_RE.test(value.trim());
}

function isCommentNode(node: TreeNode): boolean {
  return node.name === "";
}

interface TreeRow {
  /** Entry text after the connector or indentation gutter. */
  value: string;
  /** 1-based depth derived from the connector prefix, when present. */
  connectorDepth: number | null;
  /** Leading whitespace width used by indentation-only rows. */
  indent: number;
  /** Whether the entry is a standalone comment (no name). */
  comment: boolean;
}

/**
 * Indentation level of a row. Comment rows are clamped to depth 1 when there is
 * no implicit root, so an oddly indented note cannot reference a missing parent.
 */
function indentationLevel(row: TreeRow, unit: number, implicitRoot: boolean): number {
  const level = Math.floor(row.indent / unit);
  if (row.comment && !implicitRoot) {
    return Math.max(1, level);
  }
  return level;
}

export function parseTree(source: string, options: TreeRenderOptions = {}): ParsedTree | null {
  const normalized = source.replace(/\r\n?/g, "\n").replace(ANSI_RE, "");
  const lines = stripCommonIndent(normalized.split("\n"));

  const rows: TreeRow[] = [];
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

    const trimmed = line.trim();
    if (!trimmed.startsWith("#")) {
      const footerMatch = parseFooter(trimmed);
      if (footerMatch) {
        if (rows.length === 0) {
          return null;
        }
        footer = footerMatch;
        sawFooter = true;
        continue;
      }
    }

    const connector = CONNECTOR_RE.exec(line);
    if (connector?.groups) {
      const prefix = connector.groups.prefix ?? "";
      if (prefix.length % 4 !== 0) {
        return null;
      }
      const value = connector.groups.name ?? "";
      if (value.trim() === "") {
        return null;
      }
      rows.push({
        value,
        connectorDepth: prefix.length / 4 + 1,
        indent: 0,
        comment: isCommentEntry(value),
      });
      continue;
    }

    const leading = LEADING_INDENT_RE.exec(line);
    const indent = leading ? leading[0].length : 0;
    const value = line.slice(indent);
    if (value.trim() === "") {
      continue;
    }
    rows.push({ value, connectorDepth: null, indent, comment: isCommentEntry(value) });
  }

  if (rows.length === 0) {
    return null;
  }

  const first = rows[0]!;
  if (first.connectorDepth !== null || first.comment) {
    return null;
  }

  const hasConnector = rows.some((row) => row.connectorDepth !== null);
  let root: TreeNode | null;
  let start: number;
  let depthOf: (row: TreeRow) => number;

  if (hasConnector) {
    // Connector trees keep the historical 4-column unit. Mixed fences accept
    // indentation-only rows as long as they are nested below an existing row.
    root = makeRoot(first.value);
    if (!root) {
      return null;
    }
    start = 1;
    depthOf = (row) => {
      if (row.connectorDepth !== null) {
        return row.connectorDepth;
      }
      if (!row.comment && row.indent === 0) {
        // Plain text below a connector tree is not tree output.
        return Number.NaN;
      }
      return Math.floor(row.indent / 4) + 1;
    };
  } else {
    // Indentation-only tree. The unit is the smallest positive indentation of a
    // named row (fallback 2). A fence with no positive indentation is plain
    // text, so it keeps falling back to a code block.
    if (first.indent !== 0) {
      return null;
    }
    const positive = rows.filter((row) => row.indent > 0);
    if (positive.length === 0) {
      return null;
    }
    const named = positive.filter((row) => !row.comment).map((row) => row.indent);
    const unit = named.length > 0 ? Math.min(...named) : 2;

    // Several named rows at level zero mean the first line is not the only
    // root: wrap them in an implicit `.` root, the same name `tree` prints for
    // a directory. Comment rows never decide the root shape.
    const implicitRoot = rows
      .slice(1)
      .some((row) => !row.comment && Math.floor(row.indent / unit) === 0);
    if (implicitRoot) {
      root = {
        name: ".",
        depth: 0,
        directory: true,
        children: [],
        count: 0,
        comment: null,
        implicitRoot: true,
      };
      start = 0;
      depthOf = (row) => indentationLevel(row, unit, true) + 1;
    } else {
      root = makeRoot(first.value);
      if (!root) {
        return null;
      }
      start = 1;
      depthOf = (row) => indentationLevel(row, unit, false);
    }
  }

  const stack: TreeNode[] = [root];
  for (let index = start; index < rows.length; index += 1) {
    const row = rows[index]!;
    let depth = depthOf(row);
    if (row.comment) {
      // Notes never invalidate a fence and never reshape the path: an
      // over-indented note attaches to the deepest existing row, and the stack
      // is left untouched so later rows keep their parent.
      depth = Math.min(Number.isFinite(depth) ? depth : stack.length, stack.length);
    } else {
      while (stack.length > depth) {
        stack.pop();
      }
    }
    if (!Number.isFinite(depth) || depth < 1 || depth > MAX_DEPTH) {
      return null;
    }
    if (!row.comment && stack.length !== depth) {
      return null;
    }
    const parent = stack[depth - 1];
    if (!parent) {
      return null;
    }

    const { name, comment } = splitComment(row.value);
    if (name === "" && comment === null) {
      return null;
    }
    const node: TreeNode = {
      name,
      depth,
      directory: name.endsWith("/"),
      children: [],
      count: 0,
      comment,
      implicitRoot: false,
    };
    parent.children.push(node);
    // Standalone comments are decoration: they never become a parent for the
    // following rows.
    if (!isCommentNode(node)) {
      stack.push(node);
    }
  }

  if (!root.children.some((child) => !isCommentNode(child))) {
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

function formatComment(comment: string): string {
  const text = comment === "" ? "#" : `# ${comment}`;
  return `<span class="mdprv-tree-comment">${escapeText(text)}</span>`;
}

function renderCommentRow(node: TreeNode): string {
  return `<li class="mdprv-tree-item mdprv-tree-item--leaf"><div class="mdprv-tree-row mdprv-tree-row--leaf mdprv-tree-row--comment">${CHEVRON_SPACER}${formatComment(node.comment ?? "")}</div></li>`;
}

function renderLeaf(node: TreeNode, notes = ""): string {
  const icon = node.directory ? FOLDER_ICON : FILE_ICON;
  const comment = node.comment === null ? "" : formatComment(node.comment);
  return `<li class="mdprv-tree-item mdprv-tree-item--leaf"><div class="mdprv-tree-row mdprv-tree-row--leaf">${CHEVRON_SPACER}${icon}<span class="mdprv-tree-name">${escapeText(node.name)}</span>${comment}</div>${notes}</li>`;
}

function renderNode(node: TreeNode): string {
  if (isCommentNode(node)) {
    return renderCommentRow(node);
  }

  const hasRealChildren = node.children.some((child) => !isCommentNode(child));
  if (!node.directory || !hasRealChildren) {
    // A leaf may still carry standalone comment rows; keep them nested.
    const notes =
      node.children.length > 0
        ? `<ul class="mdprv-tree-group">${node.children.map(renderNode).join("")}</ul>`
        : "";
    return renderLeaf(node, notes);
  }

  const open = node.depth <= INITIAL_OPEN_DEPTH;
  const count =
    node.count > 0 ? `<span class="mdprv-tree-count">${formatCount(node.count)}</span>` : "";
  const comment = node.comment === null ? "" : formatComment(node.comment);
  const children = node.children.map(renderNode).join("");

  return `<li class="mdprv-tree-item mdprv-tree-item--dir"><details class="mdprv-tree-dir"${open ? " open" : ""}><summary class="mdprv-tree-row" role="button" aria-expanded="${open ? "true" : "false"}">${CHEVRON_ICON}${FOLDER_ICON}<span class="mdprv-tree-name">${escapeText(node.name)}</span>${comment}${count}</summary><ul class="mdprv-tree-group">${children}</ul></details></li>`;
}

function hasCollapsible(node: TreeNode): boolean {
  if (isCommentNode(node)) {
    return false;
  }
  if (node.directory && node.children.some((child) => !isCommentNode(child))) {
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

  // An implicit `.` root exists only to group top-level entries: it has no row
  // of its own, so its children are rendered directly in the list.
  const hiddenRoot = parsed.root.implicitRoot;
  const content = hiddenRoot
    ? parsed.root.children.map(renderNode).join("")
    : renderNode(parsed.root);

  const collapsible = hiddenRoot
    ? parsed.root.children.some(hasCollapsible)
    : hasCollapsible(parsed.root);

  // The raw view reuses the fence body that `tree` would have printed. Shiki
  // renders it server-side, so the markup below is trusted HTML; the body is
  // never interpolated as text here.
  const rawHtml = options.renderSource?.(source) ?? "";
  const raw =
    rawHtml.trim() === ""
      ? ""
      : `<div class="mdprv-tree-raw" data-mdprv-tree-raw hidden>${rawHtml}</div>`;
  const rawToggle =
    raw === ""
      ? ""
      : '<button type="button" class="mdprv-view-btn mdprv-tree-raw-toggle" data-mdprv-tree-action="raw" aria-pressed="false">Raw</button>';
  const actions = collapsible
    ? '<button type="button" class="mdprv-tree-action" data-mdprv-tree-action="expand">Expandir tudo</button><button type="button" class="mdprv-tree-action" data-mdprv-tree-action="collapse">Recolher tudo</button>'
    : "";
  const toolbar =
    rawToggle === "" && actions === ""
      ? ""
      : `<div class="mdprv-tree-toolbar" data-mdprv-tree-toolbar hidden>${rawToggle}${actions}</div>`;

  return `<div class="mdprv-tree" data-mdprv-tree role="group" aria-label="Árvore de diretórios">${toolbar}<ul class="mdprv-tree-list">${content}</ul>${raw}</div>`;
}
