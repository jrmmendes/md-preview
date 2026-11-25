import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import type { ThemeRegistration, ThemedTokenWithVariants } from "shiki/types";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import javascript from "@shikijs/langs/javascript";
import typescript from "@shikijs/langs/typescript";
import json from "@shikijs/langs/json";
import lua from "@shikijs/langs/lua";
import bash from "@shikijs/langs/bash";
import csv from "@shikijs/langs/csv";
import html from "@shikijs/langs/html";
import css from "@shikijs/langs/css";
import markdown from "@shikijs/langs/markdown";
import python from "@shikijs/langs/python";
import rust from "@shikijs/langs/rust";
import go from "@shikijs/langs/go";
import yaml from "@shikijs/langs/yaml";
import tsx from "@shikijs/langs/tsx";
import jsx from "@shikijs/langs/jsx";
import sql from "@shikijs/langs/sql";
import xml from "@shikijs/langs/xml";
import githubLight from "@shikijs/themes/github-light";
import githubDark from "@shikijs/themes/github-dark";

import type { ThemePrefs } from "../../shared/theme-prefs";
import { getTheme } from "../themes/index";
import type { ShikiCustomTheme } from "../themes/shiki-custom";
import { getShikiThemeStore, isKnownShikiTheme } from "../themes/shiki-index";
import { BUILTIN_SHIKI_THEMES } from "./shiki-builtins";

export const LANGS = [
  javascript,
  typescript,
  json,
  lua,
  bash,
  csv,
  html,
  css,
  markdown,
  python,
  rust,
  go,
  yaml,
  tsx,
  jsx,
  sql,
  xml,
];

export const FALLBACK_LIGHT = "github-light";
export const FALLBACK_DARK = "github-dark";

const BUILTIN_BY_NAME = new Map<string, (typeof BUILTIN_SHIKI_THEMES)[number]>(
  BUILTIN_SHIKI_THEMES.map((theme) => [theme.name, theme])
);
const INTERNAL_PREFIX = "mdprv-";

let highlighter: HighlighterCore | null = null;
let warming: Promise<void> | null = null;
const warnedThemes = new Set<string>();

function warnOnce(name: string, err: unknown): void {
  if (warnedThemes.has(name)) {
    return;
  }
  warnedThemes.add(name);
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(`md-preview: could not load Shiki theme ${name}: ${detail}\n`);
}

/**
 * Boots the highlighter with only the universal fallback pair and the bundled
 * languages. Every other builtin/custom theme is loaded on first use, so boot
 * stays independent of the 65-theme catalog.
 */
export function warmup(): Promise<void> {
  if (!warming) {
    warming = createHighlighterCore({
      themes: [githubLight, githubDark],
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

function loadedThemes(): string[] {
  return (highlighter?.getLoadedThemes() as string[] | undefined) ?? [];
}

/**
 * Loads an already-validated custom theme under a content-addressed internal
 * name (`mdprv-<slug>-<sha8>`). A new edit gets a new internal name, so the
 * renderer cache invalidates without ever unloading the old registration.
 */
export async function registerShikiTheme(theme: ShikiCustomTheme): Promise<string | null> {
  await warmup();
  if (!highlighter) {
    return null;
  }
  const internal = `${INTERNAL_PREFIX}${theme.name}-${theme.sha}`;
  if (loadedThemes().includes(internal)) {
    return internal;
  }
  try {
    await highlighter.loadTheme({
      ...theme.registration,
      name: internal,
      type: theme.kind,
    });
    return internal;
  } catch (err) {
    warnOnce(theme.name, err);
    return null;
  }
}

/**
 * Ensures a public Shiki name is registered and returns the internal name used
 * by the highlighter. Returns `null` (never throws) for unknown names or load
 * failures so a request can fall back to a plain code block.
 */
export async function ensureShikiTheme(publicName: string): Promise<string | null> {
  await warmup();
  if (!highlighter) {
    return null;
  }
  if (publicName.startsWith(INTERNAL_PREFIX) && loadedThemes().includes(publicName)) {
    return publicName;
  }
  const builtin = BUILTIN_BY_NAME.get(publicName);
  if (builtin) {
    if (loadedThemes().includes(publicName)) {
      return publicName;
    }
    try {
      await highlighter.loadTheme((await builtin.load()) as ThemeRegistration);
      return publicName;
    } catch (err) {
      warnOnce(publicName, err);
      return null;
    }
  }
  const custom = getShikiThemeStore().get(publicName);
  if (custom) {
    return registerShikiTheme(custom);
  }
  warnOnce(publicName, "theme is not a builtin or an imported custom theme");
  return null;
}

/** Public names (builtin or custom) after overrides and fallbacks. */
export interface ShikiSelection {
  light: string;
  dark: string;
}

/** Internal names registered in the highlighter for one render. */
export interface ShikiPair {
  light: string;
  dark: string;
}

function pickSelection(
  candidate: string | undefined,
  themeSlot: string,
  fallback: string
): string {
  if (candidate && isKnownShikiTheme(candidate)) {
    return candidate;
  }
  if (isKnownShikiTheme(themeSlot)) {
    return themeSlot;
  }
  return fallback;
}

/**
 * Resolves the effective public pair for a theme, honoring per-browser
 * overrides. Missing custom themes fall back per slot (`github-light`/`-dark`)
 * so a theme copied from another machine still renders.
 */
export function resolveShikiSelection(
  themeName: string,
  overrides?: ThemePrefs | null
): ShikiSelection {
  const theme = getTheme(themeName);
  return {
    light: pickSelection(
      overrides?.shiki?.light,
      theme.light.shiki.light,
      FALLBACK_LIGHT
    ),
    dark: pickSelection(
      overrides?.shiki?.dark,
      theme.dark.shiki.dark,
      FALLBACK_DARK
    ),
  };
}

/** Legacy public-name pair, kept for compatibility with sync callers. */
export function resolveShikiPair(
  themeName: string,
  overrides?: ThemePrefs | null
): ShikiPair {
  return resolveShikiSelection(themeName, overrides);
}

/** Resolves and loads both sides once per render, returning internal names. */
export async function prepareShikiPair(
  themeName: string,
  overrides?: ThemePrefs | null
): Promise<ShikiPair> {
  const selection = resolveShikiSelection(themeName, overrides);
  let light = await ensureShikiTheme(selection.light);
  let dark = await ensureShikiTheme(selection.dark);
  if (!light) {
    light = await ensureShikiTheme(FALLBACK_LIGHT);
  }
  if (!dark) {
    dark = await ensureShikiTheme(FALLBACK_DARK);
  }
  return {
    light: light ?? FALLBACK_LIGHT,
    dark: dark ?? FALLBACK_DARK,
  };
}

export function codeToThemedTokensWithPair(
  code: string,
  lang: string,
  pair: ShikiPair
): ThemedTokenWithVariants[][] | null {
  if (!highlighter || !lang) {
    return null;
  }
  const loaded = highlighter.getLoadedLanguages() as string[];
  if (!loaded.includes(lang)) {
    return null;
  }
  try {
    return highlighter.codeToTokensWithThemes(code, {
      lang,
      themes: { light: pair.light, dark: pair.dark },
    } as never);
  } catch {
    return null;
  }
}

export function codeToHtmlWithPair(code: string, lang: string, pair: ShikiPair): string {
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
  try {
    return highlighter.codeToHtml(code, {
      lang: language,
      themes: { light: pair.light, dark: pair.dark },
      defaultColor: false,
    });
  } catch {
    return "";
  }
}

/** Legacy sync wrapper; prefers `prepareShikiPair` in async render paths. */
export function codeToThemedTokens(
  code: string,
  lang: string,
  themeName: string,
  overrides?: ThemePrefs | null
): ThemedTokenWithVariants[][] | null {
  return codeToThemedTokensWithPair(code, lang, resolveShikiPair(themeName, overrides));
}

/** Legacy sync wrapper, kept for callers that already warmed the pair up. */
export function codeToHtml(
  code: string,
  lang: string,
  themeName: string,
  overrides?: ThemePrefs | null
): string {
  return codeToHtmlWithPair(code, lang, resolveShikiPair(themeName, overrides));
}

export interface SingleThemeCode {
  html: string;
  background: string;
  foreground: string;
}

/**
 * Single-theme rendering used by the settings modal and the custom-theme
 * preview. Accepts a public name or an internal `mdprv-*` name already loaded.
 */
export async function codeToHtmlSingle(
  code: string,
  lang: string,
  theme: string
): Promise<SingleThemeCode> {
  const internal = await ensureShikiTheme(theme);
  if (!internal || !highlighter) {
    return { html: "", background: "", foreground: "" };
  }
  const loaded = highlighter.getLoadedLanguages() as string[];
  const language = lang && loaded.includes(lang) ? lang : loaded.includes("text") ? "text" : "";
  if (!language) {
    return { html: "", background: "", foreground: "" };
  }
  try {
    const resolved = highlighter.getTheme(internal);
    // Emit the same theme into both variant slots so the preview markup only
    // carries `--shiki-*` variables. The card then chooses a slot by its own
    // `data-preview-scheme`, independent of the page's `data-scheme`.
    const html = highlighter.codeToHtml(code, {
      lang: language,
      themes: { light: internal, dark: internal },
      defaultColor: false,
    });
    return { html, background: resolved.bg, foreground: resolved.fg };
  } catch {
    return { html: "", background: "", foreground: "" };
  }
}
