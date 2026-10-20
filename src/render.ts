import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import javascript from "@shikijs/langs/javascript";
import typescript from "@shikijs/langs/typescript";
import json from "@shikijs/langs/json";
import lua from "@shikijs/langs/lua";
import bash from "@shikijs/langs/bash";
import html from "@shikijs/langs/html";
import css from "@shikijs/langs/css";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import githubLight from "@shikijs/themes/github-light";
import githubDark from "@shikijs/themes/github-dark";
import dracula from "@shikijs/themes/dracula";
import nord from "@shikijs/themes/nord";
import solarizedDark from "@shikijs/themes/solarized-dark";
import solarizedLight from "@shikijs/themes/solarized-light";
import gruvboxDark from "@shikijs/themes/gruvbox-dark-medium";
import gruvboxLight from "@shikijs/themes/gruvbox-light-medium";
import { getTheme, shikiThemeNames } from "./themes";

const LANGS = [javascript, typescript, json, lua, bash, html, css, markdown, python];

const THEME_MODULES: Record<string, unknown> = {
  "github-light": githubLight,
  "github-dark": githubDark,
  dracula: dracula,
  nord: nord,
  "solarized-dark": solarizedDark,
  "solarized-light": solarizedLight,
  "gruvbox-dark-medium": gruvboxDark,
  "gruvbox-light-medium": gruvboxLight,
};

let highlighter: HighlighterCore | null = null;
let warming: Promise<void> | null = null;

const mdCache = new Map<string, MarkdownIt>();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function warmup(): Promise<void> {
  if (!warming) {
    const themes = shikiThemeNames()
      .map((name) => THEME_MODULES[name])
      .filter(Boolean);
    warming = createHighlighterCore({
      themes: themes as never[],
      langs: LANGS,
      engine: createOnigurumaEngine(import("shiki/wasm")),
    }).then((h) => {
      highlighter = h;
    });
  }
  return warming;
}

function createRenderer(themeName: string): MarkdownIt {
  const theme = getTheme(themeName);
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

  const shikiOptions = theme.shiki
    ? { theme: theme.shiki }
    : { themes: { light: theme.shikiLight!, dark: theme.shikiDark! }, defaultColor: false as const };

  md.options.highlight = (code: string, lang: string): string => {
    if (!highlighter) return "";
    const loaded = highlighter.getLoadedLanguages() as string[];
    let language = lang && loaded.includes(lang) ? lang : "";
    if (!language && loaded.includes("text")) {
      language = "text";
    }
    if (!language) {
      return "";
    }
    try {
      return highlighter.codeToHtml(code, { lang: language, ...shikiOptions });
    } catch {
      return "";
    }
  };

  const defaultFence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const info = tokens[idx].info.trim().split(/\s+/)[0] || "";
    if (info === "mermaid") {
      return '<pre class="mermaid">' + escapeHtml(tokens[idx].content) + "</pre>\n";
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
  slug: string
): Promise<string> {
  await warmup();
  const md = rendererFor(themeName);
  return md.render(content, { slug });
}
