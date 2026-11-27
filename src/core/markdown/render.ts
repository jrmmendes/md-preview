import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

import { renderDiff } from "./diff";
import {
  codeToHtmlWithPair,
  prepareShikiPair,
  warmup,
  type ShikiPair,
} from "./highlight";
import { renderCsvTable, renderGfmTableClose, renderGfmTableOpen, renderTableRawHtml } from "./table";
import { renderTree } from "./tree";
import type { DocLinkState } from "../doc-links";
import { EMOJI_SHORTCODE_PATTERN } from "../emoji/constants";
import { getEmojiStore, emojiAssetExists } from "../emoji/index";
import type { EmojiPack } from "../emoji/types";
import type { ThemePrefs } from "../../shared/theme-prefs";

export { warmup };

export interface DocLinkResolution {
  href: string;
  state: DocLinkState;
}

export type DocLinkResolver = (href: string) => DocLinkResolution | null;

export interface RenderOptions {
  /** Optional hook that rewrites sibling Markdown links at render time. */
  docLinkResolver?: DocLinkResolver;
  /** Per-browser Shiki/Mermaid overrides for this request. */
  themeOverrides?: ThemePrefs | null;
  /** Emoji pack for `:shortcode:` expansion; defaults to the active store. */
  emoji?: EmojiPack | null;
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
  /** Per-render memo for emoji SVG asset lookups. */
  emojiAssets?: Map<string, boolean>;
}

/**
 * Original Markdown lines of a GFM table, highlighted for the per-block Raw
 * view. Returns an empty string when the token carries no line map (nested
 * containers edge cases) so the toggle is simply omitted.
 */
function gfmRawHtml(
  lines: [number, number] | null | undefined,
  source: string | undefined,
  pair: ShikiPair
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
  return renderTableRawHtml(text, codeToHtmlWithPair(text, "markdown", pair));
}

function nextTableSeq(env: RenderEnv): number {
  const seq = (env.tableSeq ?? 0) + 1;
  env.tableSeq = seq;
  return seq;
}

const MAX_RENDERERS = 64;
const mdCache = new Map<string, MarkdownIt>();

/**
 * Renderers embed the Shiki pair in their render rules, so the cache key must
 * include it; otherwise the first request would pin its overrides for all
 * later requests with the same theme name. Custom themes use the internal
 * content-addressed name, so editing one invalidates the renderer. The emoji
 * pack id does the same for `:shortcode:` rules.
 */
function rendererKey(
  themeName: string,
  light: string,
  dark: string,
  emojiId: string
): string {
  return `${themeName}|${light}|${dark}|${emojiId}`;
}

const SHORTCODE_INLINE = new RegExp(`^:(${EMOJI_SHORTCODE_PATTERN}):`);

function emojiHtml(
  pack: EmojiPack,
  name: string,
  value: string,
  hasAsset: (shortcode: string) => boolean
): string {
  if (value.startsWith("data:image/")) {
    return `<img class="mdprv-emoji" src="${value}" alt=":${name}:" loading="lazy">`;
  }
  if (pack.style !== "native" && hasAsset(name)) {
    return `<img class="mdprv-emoji" src="/__emoji-assets/${pack.name}/${encodeURIComponent(name)}.svg" alt=":${name}:" loading="lazy">`;
  }
  return Bun.escapeHTML(value);
}

function createRenderer(themeName: string, pair: ShikiPair, emoji: EmojiPack): MarkdownIt {
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

  md.options.highlight = (code: string, lang: string): string =>
    codeToHtmlWithPair(code, lang, pair);

  // `:shortcode:` expansion. Inline code spans are consumed by the backtick
  // rule before this position, so `:x:` inside backticks stays literal; an
  // unknown name simply declines the match and markdown-it emits the text.
  md.inline.ruler.before("emphasis", "emoji", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x3a) {
      return false;
    }
    const match = SHORTCODE_INLINE.exec(state.src.slice(state.pos, state.pos + 70));
    if (!match) {
      return false;
    }
    const name = match[1]!;
    if (!Object.prototype.hasOwnProperty.call(emoji.shortcodes, name)) {
      return false;
    }
    if (!silent) {
      const token = state.push("emoji", "", 0);
      token.content = name;
      token.meta = emoji.shortcodes[name];
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.emoji = (tokens, idx, _options, env) => {
    const renderEnv = env as RenderEnv;
    const hasAsset = (shortcode: string): boolean => {
      const cache = (renderEnv.emojiAssets ??= new Map<string, boolean>());
      const cached = cache.get(shortcode);
      if (cached !== undefined) {
        return cached;
      }
      const exists = emojiAssetExists(emoji.name, shortcode);
      cache.set(shortcode, exists);
      return exists;
    };
    const token = tokens[idx]!;
    return emojiHtml(emoji, token.content, String(token.meta ?? ""), hasAsset);
  };

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
        renderSource: (source) => codeToHtmlWithPair(source, "csv", pair),
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
        renderSource: (source) => codeToHtmlWithPair(source, "bash", pair),
      });
      if (tree !== null) {
        return tree + "\n";
      }
    }
    if (info === "diff") {
      const diff = renderDiff(tokens[idx].content, parts[1] || "", { pair });
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
    const rawHtml = gfmRawHtml(token.map, renderEnv.source, pair);
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

function rendererFor(themeName: string, pair: ShikiPair, emoji: EmojiPack): MarkdownIt {
  const key = rendererKey(themeName, pair.light, pair.dark, emoji.id);
  let md = mdCache.get(key);
  if (!md) {
    md = createRenderer(themeName, pair, emoji);
    mdCache.set(key, md);
    if (mdCache.size > MAX_RENDERERS) {
      const oldest = mdCache.keys().next().value;
      if (oldest !== undefined) {
        mdCache.delete(oldest);
      }
    }
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
  const pair = await prepareShikiPair(themeName, options.themeOverrides ?? null);
  const emoji = options.emoji ?? getEmojiStore().get(null);
  const md = rendererFor(themeName, pair, emoji);
  const env: RenderEnv = { slug, source: content };
  if (options.docLinkResolver) {
    env.docLinkResolver = options.docLinkResolver;
  }
  return md.render(content, env);
}
