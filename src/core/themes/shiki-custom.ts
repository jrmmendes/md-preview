/**
 * Validation and normalization of user-imported Shiki themes.
 *
 * The daemon only accepts the `.shiki.json` wrapper documented in
 * `docs/referencia/temas-shiki.md`; a bare VS Code/TextMate JSON theme is a
 * client-side convenience that the modal wraps before sending. Every field is
 * projected into a fresh `ThemeRegistration`, so unknown/internal keys never
 * reach the highlighter and colors are validated one by one.
 */
import { createHash } from "node:crypto";

import type { ThemeRegistration } from "shiki/types";

import { isColor } from "./color";
import {
  SHIKI_THEME_ID_RE,
  type BuiltinShikiThemeName,
} from "./constants";
import { BUILTIN_SHIKI_THEME_NAMES } from "../markdown/shiki-builtins";

export const SHIKI_FILE_SUFFIX = ".shiki.json";
export const SHIKI_THEME_SCHEMA_FILE = "shiki-theme.schema.json";
export const MAX_SHIKI_THEMES = 100;
export const MAX_SHIKI_COLORS = 1_024;
export const MAX_SHIKI_TOKENS = 2_000;
export const MAX_SHIKI_SCOPE_CHARS = 2_048;
const MAX_SCOPE_LIST = 50;

export type ShikiThemeErrorCode = "invalid" | "exists" | "too-large" | "too-many";

export class ShikiThemeError extends Error {
  constructor(
    public readonly code: ShikiThemeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ShikiThemeError";
  }
}

export interface ShikiCustomTheme {
  name: string;
  kind: "light" | "dark";
  registration: ThemeRegistration;
  sha: string;
}

const ROOT_KEYS = new Set(["schemaVersion", "name", "type", "theme"]);
const THEME_KEYS = new Set([
  "name",
  "displayName",
  "type",
  "colors",
  "settings",
  "tokenColors",
  "fg",
  "bg",
  "semanticHighlighting",
  "semanticTokenColors",
]);
const COLOR_KEY_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const FONT_STYLE_RE = /^[a-z ]{0,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new ShikiThemeError("invalid", message);
}

export function isBuiltinShikiTheme(name: string): name is BuiltinShikiThemeName {
  return BUILTIN_SHIKI_THEME_NAMES.has(name);
}

/** Human label used by the modal menus and the page payload. */
export function shikiLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function shikiFileName(name: string): string {
  return `${name}${SHIKI_FILE_SUFFIX}`;
}

function relativeLuminance(value: string): number | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function inferKind(bg: string | undefined): "light" | "dark" | null {
  if (!bg) {
    return null;
  }
  const value = relativeLuminance(bg);
  if (value === null) {
    return null;
  }
  return value < 0.5 ? "dark" : "light";
}

function validateColors(raw: unknown): Record<string, string> | undefined {
  if (!isRecord(raw)) {
    invalid("theme.colors must be an object");
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_SHIKI_COLORS) {
    throw new ShikiThemeError(
      "too-many",
      `theme.colors has too many entries (max ${MAX_SHIKI_COLORS})`
    );
  }
  const colors: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!COLOR_KEY_RE.test(key) || key.length > 64) {
      invalid(`theme.colors.${key} is not a valid color key`);
    }
    if (!isColor(value)) {
      invalid(`theme.colors.${key} must be a safe CSS color`);
    }
    colors[key] = value;
  }
  return colors;
}

function validateTokenList(raw: unknown, label: string): unknown[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    invalid(`theme.${label} must be an array`);
  }
  if (raw.length > MAX_SHIKI_TOKENS) {
    throw new ShikiThemeError(
      "too-many",
      `theme.${label} has too many entries (max ${MAX_SHIKI_TOKENS})`
    );
  }
  return raw;
}

function validateScope(value: unknown, label: string): string | string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    if (value.length > MAX_SHIKI_SCOPE_CHARS) {
      invalid(`${label}.scope must be at most ${MAX_SHIKI_SCOPE_CHARS} characters`);
    }
    return value;
  }
  if (!Array.isArray(value)) {
    invalid(`${label}.scope must be a string or an array of strings`);
  }
  if (value.length > MAX_SCOPE_LIST) {
    invalid(`${label}.scope has too many entries (max ${MAX_SCOPE_LIST})`);
  }
  return value.map((entry) => {
    if (typeof entry !== "string" || entry.length > MAX_SHIKI_SCOPE_CHARS) {
      invalid(`${label}.scope entries must be strings of at most ${MAX_SHIKI_SCOPE_CHARS} characters`);
    }
    return entry;
  });
}

function validateTokenSettings(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    invalid(`${label}.settings must be an object`);
  }
  const settings: Record<string, unknown> = {};
  if ("foreground" in value) {
    if (!isColor(value.foreground)) {
      invalid(`${label}.settings.foreground must be a safe CSS color`);
    }
    settings.foreground = value.foreground;
  }
  if ("background" in value) {
    if (!isColor(value.background)) {
      invalid(`${label}.settings.background must be a safe CSS color`);
    }
    settings.background = value.background;
  }
  if ("fontStyle" in value) {
    if (typeof value.fontStyle !== "string" || !FONT_STYLE_RE.test(value.fontStyle)) {
      invalid(`${label}.settings.fontStyle must be a safe font style`);
    }
    settings.fontStyle = value.fontStyle;
  }
  return Object.keys(settings).length > 0 ? settings : undefined;
}

function validateTokens(raw: unknown, label: string): unknown[] | undefined {
  const items = validateTokenList(raw, label);
  if (!items) {
    return undefined;
  }
  return items.map((entry, index) => {
    const itemLabel = `theme.${label}[${index}]`;
    if (!isRecord(entry)) {
      invalid(`${itemLabel} must be an object`);
    }
    const out: Record<string, unknown> = {};
    const scope = validateScope(entry.scope, itemLabel);
    if (scope !== undefined) {
      out.scope = scope;
    }
    const settings = validateTokenSettings(entry.settings, itemLabel);
    if (settings !== undefined) {
      out.settings = settings;
    }
    return out;
  });
}

function validateSemanticTokens(raw: unknown): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    invalid("theme.semanticTokenColors must be an object");
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_SHIKI_COLORS) {
    throw new ShikiThemeError(
      "too-many",
      `theme.semanticTokenColors has too many entries (max ${MAX_SHIKI_COLORS})`
    );
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > 64) {
      invalid("theme.semanticTokenColors keys must be 1..64 characters");
    }
    if (isColor(value)) {
      out[key] = value;
      continue;
    }
    if (!isRecord(value)) {
      invalid(`theme.semanticTokenColors.${key} must be a color or an object`);
    }
    const token: Record<string, unknown> = {};
    if ("foreground" in value) {
      if (!isColor(value.foreground)) {
        invalid(`theme.semanticTokenColors.${key}.foreground must be a safe CSS color`);
      }
      token.foreground = value.foreground;
    }
    for (const flag of ["bold", "italic", "underline"] as const) {
      if (flag in value) {
        if (typeof value[flag] !== "boolean") {
          invalid(`theme.semanticTokenColors.${key}.${flag} must be a boolean`);
        }
        token[flag] = value[flag];
      }
    }
    out[key] = token;
  }
  return out;
}

/**
 * Validates the wrapper and returns a normalized theme ready for Shiki.
 * Throws `ShikiThemeError` with `invalid`, `exists` or `too-many`.
 */
export function validateShikiCustom(raw: unknown, expectedName?: string): ShikiCustomTheme {
  if (!isRecord(raw)) {
    invalid("theme wrapper must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      invalid(`unknown wrapper key ${JSON.stringify(key)}`);
    }
  }
  if (raw.schemaVersion !== 1) {
    invalid("schemaVersion must be 1");
  }
  if (typeof raw.name !== "string" || !SHIKI_THEME_ID_RE.test(raw.name)) {
    invalid("name must match ^[a-z0-9][a-z0-9-]{0,31}$");
  }
  const name = raw.name;
  if (name === "auto" || isBuiltinShikiTheme(name)) {
    throw new ShikiThemeError("exists", `theme name ${name} is reserved`);
  }
  if (expectedName !== undefined && name !== expectedName) {
    invalid(`name must equal the file name (${expectedName})`);
  }
  if (raw.type !== undefined && raw.type !== "light" && raw.type !== "dark") {
    invalid("type must be light or dark");
  }
  if (!isRecord(raw.theme)) {
    invalid("theme must be an object");
  }
  const theme = raw.theme;
  for (const key of Object.keys(theme)) {
    if (!THEME_KEYS.has(key)) {
      invalid(`unknown theme key ${JSON.stringify(key)}`);
    }
  }
  if (theme.name !== undefined && theme.name !== name) {
    invalid("theme.name must equal the wrapper name");
  }
  if (theme.type !== undefined && theme.type !== "light" && theme.type !== "dark") {
    invalid("theme.type must be light or dark");
  }
  if (theme.displayName !== undefined) {
    if (
      typeof theme.displayName !== "string" ||
      theme.displayName.length === 0 ||
      theme.displayName.length > 128
    ) {
      invalid("theme.displayName must be a non-empty string of at most 128 characters");
    }
  }

  const colors = "colors" in theme ? validateColors(theme.colors) : undefined;
  const bgValue =
    (colors?.["editor.background"] as string | undefined) ??
    (colors?.bg as string | undefined) ??
    (typeof theme.bg === "string" ? theme.bg : undefined);
  const kind =
    (raw.type as "light" | "dark" | undefined) ??
    (theme.type as "light" | "dark" | undefined) ??
    inferKind(bgValue);
  if (!kind) {
    invalid("shiki theme type is required or must be inferable from the background color");
  }

  const registration: ThemeRegistration = { name, type: kind };
  if (typeof theme.displayName === "string") {
    registration.displayName = theme.displayName;
  }
  if (colors) {
    registration.colors = colors;
  }
  const settings = validateTokens(theme.settings, "settings");
  if (settings) {
    registration.settings = settings as never;
  }
  const tokenColors = validateTokens(theme.tokenColors, "tokenColors");
  if (tokenColors) {
    registration.tokenColors = tokenColors as never;
  }
  if (theme.fg !== undefined) {
    if (!isColor(theme.fg)) {
      invalid("theme.fg must be a safe CSS color");
    }
    registration.fg = theme.fg;
  }
  if (theme.bg !== undefined) {
    if (!isColor(theme.bg)) {
      invalid("theme.bg must be a safe CSS color");
    }
    registration.bg = theme.bg;
  }
  if (theme.semanticHighlighting !== undefined) {
    if (typeof theme.semanticHighlighting !== "boolean") {
      invalid("theme.semanticHighlighting must be a boolean");
    }
    registration.semanticHighlighting = theme.semanticHighlighting;
  }
  const semantic = validateSemanticTokens(theme.semanticTokenColors);
  if (semantic) {
    registration.semanticTokenColors = semantic as never;
  }

  const sha = createHash("sha1").update(JSON.stringify(registration)).digest("hex").slice(0, 8);
  return { name, kind, registration, sha };
}
