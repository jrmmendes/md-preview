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

import { getTheme, shikiThemeNames } from "../themes/index";

export const LANGS = [javascript, typescript, json, lua, bash, html, css, markdown, python];

export const THEME_MODULES: Record<string, unknown> = {
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

export async function getHighlighter(): Promise<HighlighterCore> {
  await warmup();
  if (!highlighter) {
    throw new Error("shiki highlighter unavailable");
  }
  return highlighter;
}

export function codeToHtml(code: string, lang: string, themeName: string): string {
  if (!highlighter) {
    return "";
  }
  const loaded = highlighter.getLoadedLanguages() as string[];
  let language = lang && loaded.includes(lang) ? lang : "";
  if (!language && loaded.includes("text")) {
    language = "text";
  }
  if (!language) {
    return "";
  }
  const theme = getTheme(themeName);
  try {
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: { light: theme.light.shiki.light, dark: theme.dark.shiki.dark },
      defaultColor: false,
    });
  } catch {
    return "";
  }
}
