/**
 * Personalizações de código/diagrama por navegador.
 *
 * O `localStorage` é a fonte da verdade; este módulo só define o formato puro
 * que viaja no cookie `mdprv_prefs` até o renderizador do daemon. O servidor
 * nunca confia em outro campo e descarta silenciosamente qualquer cookie
 * inválido (JSON, versão, chave ou valor fora da allowlist).
 */
import {
  SHIKI_THEME_ID_RE,
  THEME_NAME_RE,
  type MermaidThemeName,
  type ShikiThemeName,
} from "../core/themes/constants";

export const THEME_PREFS_VERSION = 1;
export const THEME_PREFS_COOKIE = "mdprv_prefs";
/** `localStorage` keys written by the settings modal. */
export const THEME_PREFS_SHIKI_KEY = "mdprv_shiki";
export const THEME_PREFS_MERMAID_KEY = "mdprv_mermaid";
/** Block-customization flags (`{v:1, fonte, loader, codigo, graficos}`). */
export const THEME_PREFS_BLOCKS_KEY = "mdprv_blocks";
/** Cookie values above this size are discarded instead of parsed. */
export const THEME_PREFS_MAX_BYTES = 512;

export interface ThemePrefs {
  v: 1;
  shiki?: { light: ShikiThemeName; dark: ShikiThemeName };
  mermaid?: { light: MermaidThemeName; dark: MermaidThemeName };
}

const KNOWN_KEYS = new Set(["v", "shiki", "mermaid"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isShikiName(value: unknown): value is ShikiThemeName {
  return typeof value === "string" && SHIKI_THEME_ID_RE.test(value);
}

function isMermaidName(value: unknown): value is MermaidThemeName {
  return typeof value === "string" && THEME_NAME_RE.test(value);
}

function parseShiki(
  value: unknown,
  isShikiTheme: (name: string) => boolean
): ThemePrefs["shiki"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.light !== "string" ||
    !isShikiTheme(value.light) ||
    typeof value.dark !== "string" ||
    !isShikiTheme(value.dark)
  ) {
    return undefined;
  }
  return { light: value.light, dark: value.dark };
}

function parseMermaid(
  value: unknown,
  isMermaidTheme: (name: string) => boolean
): ThemePrefs["mermaid"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.light !== "string" ||
    !isMermaidTheme(value.light) ||
    typeof value.dark !== "string" ||
    !isMermaidTheme(value.dark)
  ) {
    return undefined;
  }
  return { light: value.light, dark: value.dark };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export interface ParseThemePrefsOptions {
  /** Optional semantic check; defaults to the slug syntax only. */
  isShikiTheme?: (name: string) => boolean;
  /** Optional semantic check for Mermaid; defaults to the slug syntax only. */
  isMermaidTheme?: (name: string) => boolean;
}

/**
 * Parses the cookie payload. Any malformed, oversized or unknown content is
 * treated as "no preferences" so a bad cookie can never break a request.
 */
export function parseThemePrefs(
  raw: string | null,
  options: ParseThemePrefsOptions = {}
): ThemePrefs | null {
  if (raw === null) {
    return null;
  }
  const isShikiTheme = options.isShikiTheme ?? isShikiName;
  const isMermaidTheme = options.isMermaidTheme ?? isMermaidName;
  const text = raw.trim();
  if (text === "" || byteLength(text) > THEME_PREFS_MAX_BYTES) {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.v !== THEME_PREFS_VERSION) {
    return null;
  }
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) {
      return null;
    }
  }
  const shiki = "shiki" in value ? parseShiki(value.shiki, isShikiTheme) : undefined;
  if ("shiki" in value && !shiki) {
    return null;
  }
  const mermaid = "mermaid" in value ? parseMermaid(value.mermaid, isMermaidTheme) : undefined;
  if ("mermaid" in value && !mermaid) {
    return null;
  }
  const prefs: ThemePrefs = { v: THEME_PREFS_VERSION };
  if (shiki) {
    prefs.shiki = shiki;
  }
  if (mermaid) {
    prefs.mermaid = mermaid;
  }
  return prefs;
}

/** Serializes only known fields; returns `null` when there is nothing to send. */
export function serializeThemePrefs(prefs: ThemePrefs | null): string | null {
  if (!prefs) {
    return null;
  }
  // Build a fresh object so unknown fields never reach the cookie.
  const value: Record<string, unknown> = { v: THEME_PREFS_VERSION };
  if (prefs.shiki) {
    value.shiki = { light: prefs.shiki.light, dark: prefs.shiki.dark };
  }
  if (prefs.mermaid) {
    value.mermaid = { light: prefs.mermaid.light, dark: prefs.mermaid.dark };
  }
  const parsed = parseThemePrefs(JSON.stringify(value));
  if (!parsed || (!parsed.shiki && !parsed.mermaid)) {
    return null;
  }
  const encoded = JSON.stringify(parsed);
  return byteLength(encoded) > THEME_PREFS_MAX_BYTES ? null : encoded;
}

/** Reads only the `shiki`/`mermaid` fields, ignoring anything else. */
export function hasThemePrefs(prefs: ThemePrefs | null): prefs is ThemePrefs {
  return prefs !== null && (prefs.shiki !== undefined || prefs.mermaid !== undefined);
}
