import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";

import { renderDiff } from "./diff";
import { codeToHtml, warmup } from "./highlight";
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
    if (info === "tree") {
      const dirsOnly = parts.slice(1).some((part) => part === "-d" || part === "--dirs-only");
      const tree = renderTree(tokens[idx].content, { dirsOnly });
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
  const env: { slug: string; docLinkResolver?: DocLinkResolver } = { slug };
  if (options.docLinkResolver) {
    env.docLinkResolver = options.docLinkResolver;
  }
  return md.render(content, env);
}
