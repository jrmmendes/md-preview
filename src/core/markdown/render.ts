import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

import { renderDiff } from "./diff";
import { codeToHtml, warmup } from "./highlight";
import { renderCsvTable, renderGfmTableClose, renderGfmTableOpen, renderTableRawHtml } from "./table";
import { renderTree } from "./tree";
import type { DocLinkState } from "../doc-links";

export { warmup };

export interface DocLinkResolution {
  href: string;
  state: DocLinkState;
}

export type DocLinkResolver = (href: string) => DocLinkResolution | null;

export interface RenderOptions {
  /** Optional hook that rewrites sibling Markdown links at render time. */
  docLinkResolver?: DocLinkResolver;
}

interface OpenTable {
  /** Trusted Raw-view HTML for the table, empty when it has no source. */
  rawHtml: string;
}

interface RenderEnv {
  slug: string;
  docLinkResolver?: DocLinkResolver;
  /** Original Markdown; GFM tables slice it with `token.map` for the Raw view. */
  source?: string;
  /** Monotonic table counter, shared by GFM tables and csv fences. */
  tableSeq?: number;
  /** Open GFM tables, used to close the wrapper after `</table>`. */
  tableStack?: OpenTable[];
}

/**
 * Original Markdown lines of a GFM table, highlighted for the per-block Raw
 * view. Returns an empty string when the token carries no line map (nested
 * containers edge cases) so the toggle is simply omitted.
 */
function gfmRawHtml(
  lines: [number, number] | null | undefined,
  source: string | undefined,
  themeName: string
): string {
  if (!lines || source === undefined) {
    return "";
  }
  const text = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(lines[0], lines[1])
    .join("\n");
  if (text.trim() === "") {
    return "";
  }
  return renderTableRawHtml(text, codeToHtml(text, "markdown", themeName));
}

function nextTableSeq(env: RenderEnv): number {
  const seq = (env.tableSeq ?? 0) + 1;
  env.tableSeq = seq;
  return seq;
}

const mdCache = new Map<string, MarkdownIt>();

function createRenderer(themeName: string): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
  });
  md.enable(["table", "strikethrough"]);
  md.use(taskLists, { enabled: true, label: true });
  md.use(footnote);
  md.use(anchor, { tabIndex: false });

  md.options.highlight = (code: string, lang: string): string => codeToHtml(code, lang, themeName);

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const parts = tokens[idx].info.trim().split(/\s+/);
    const info = parts[0] || "";
    if (info === "mermaid") {
      return '<pre class="mermaid">' + Bun.escapeHTML(tokens[idx].content) + "</pre>\n";
    }
    if (info === "csv") {
      const csv = renderCsvTable(tokens[idx].content, {
        seq: nextTableSeq(env as RenderEnv),
        renderSource: (source) => codeToHtml(source, "csv", themeName),
      });
      if (csv !== null) {
        return csv + "\n";
      }
    }
    if (info === "tree") {
      const dirsOnly = parts.slice(1).some((part) => part === "-d" || part === "--dirs-only");
      const tree = renderTree(tokens[idx].content, {
        dirsOnly,
        // The raw toggle shows the fence body as a bash-highlighted block, the
        // same way a normal code block would be rendered.
        renderSource: (source) => codeToHtml(source, "bash", themeName),
      });
      if (tree !== null) {
        return tree + "\n";
      }
    }
    if (info === "diff") {
      const diff = renderDiff(tokens[idx].content, parts[1] || "", { themeName });
      if (diff !== null) {
        return diff + "\n";
      }
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  const defaultTableOpen =
    md.renderer.rules.table_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    const renderEnv = env as RenderEnv;
    const seq = nextTableSeq(renderEnv);
    const id = `mdprv-table-${seq}`;
    const token = tokens[idx]!;
    // The Raw view shows the table exactly as written, sliced from the source.
    const rawHtml = gfmRawHtml(token.map, renderEnv.source, themeName);
    token.attrJoin("class", "mdprv-grid");
    token.attrSet("role", "grid");
    token.attrSet("aria-label", "Tabela de dados");
    token.attrSet("id", `${id}-grid`);
    (renderEnv.tableStack ??= []).push({ rawHtml });
    return renderGfmTableOpen(seq, { rawHtml }) + defaultTableOpen(tokens, idx, options, env, self);
  };

  const defaultTableClose =
    md.renderer.rules.table_close ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.table_close = (tokens, idx, options, env, self) => {
    const stack = (env as RenderEnv).tableStack;
    const html = defaultTableClose(tokens, idx, options, env, self);
    if (!stack || stack.length === 0) {
      return html;
    }
    const table = stack.pop()!;
    return html + renderGfmTableClose({ rawHtml: table.rawHtml });
  };

  const defaultImage = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const slug = (env && env.slug) || "";
    const srcIdx = token.attrIndex("src");
    if (srcIdx >= 0 && token.attrs) {
      const src = token.attrs[srcIdx][1];
      if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src) && !src.startsWith("//")) {
        const match = src.match(/^([^?#]*)([?#].*)?$/);
        const base = match ? match[1] : src;
        const suffix = match && match[2] ? match[2] : "";
        token.attrs[srcIdx][1] = "/img/" + slug + "/" + base + suffix;
      }
    }
    return defaultImage(tokens, idx, options, env, self);
  };

  const defaultLinkOpen =
    md.renderer.rules.link_open ??
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const resolver: DocLinkResolver | undefined = env?.docLinkResolver;
    const hrefIdx = token.attrIndex("href");
    if (resolver && hrefIdx >= 0 && token.attrs) {
      const href = token.attrs[hrefIdx][1];
      const target = resolver(href);
      if (target) {
        token.attrs[hrefIdx][1] = target.href;
        if (target.state === "missing") {
          token.attrSet("data-mdprv-doc-missing", "1");
          token.attrSet("title", "Document not found");
        } else if (target.state === "pending") {
          token.attrSet("data-mdprv-doc-resolve", "1");
        }
      }
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return md;
}

function rendererFor(themeName: string): MarkdownIt {
  let md = mdCache.get(themeName);
  if (!md) {
    md = createRenderer(themeName);
    mdCache.set(themeName, md);
  }
  return md;
}

export function normalizeContent(content: string): string {
  if (content === "" || content.endsWith("\n")) {
    return content;
  }
  return content + "\n";
}

export async function renderMarkdown(
  content: string,
  themeName: string,
  slug: string,
  options: RenderOptions = {}
): Promise<string> {
  await warmup();
  const md = rendererFor(themeName);
  const env: RenderEnv = { slug, source: content };
  if (options.docLinkResolver) {
    env.docLinkResolver = options.docLinkResolver;
  }
  return md.render(content, env);
}
