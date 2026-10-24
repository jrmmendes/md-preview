import { sanitizeFamily } from "../fonts";
import {
  MERMAID_THEMES,
  SHIKI_THEME_NAMES,
  THEME_NAME_RE,
  type MermaidThemeName,
  type ShikiThemeName,
} from "./constants";
import { withDefaults } from "./defaults";
import type {
  AutoTheme,
  FixedTheme,
  Theme,
  ThemeColors,
  ThemeEffects,
  ThemeLayout,
  ThemeMermaid,
  ThemeRadii,
  ThemeShiki,
  ThemeTypography,
} from "./types";

const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_FN = /^(?:rgba?|hsla?)\(\s*[0-9.%\s,/+-]+\)$/;
const LENGTH = /^(?:0|\d*\.?\d+)(?:px|rem|em|%|ch|vw|vh)$/;
const DURATION = /^(\d*\.?\d+)(ms|s)$/;
const SHADOW = /^[A-Za-z0-9#.,()%\-/\s]+$/;
const SAFE_TEXT = /^[^;{}<>\\\u0000-\u001f\u007f]+$/;
const MERMAID_KEY = /^[A-Za-z][A-Za-z0-9]*$/;
const EASING = /^(?:linear|ease|ease-in|ease-out|ease-in-out)$/;
const CUBIC = /^cubic-bezier\(\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*,\s*-?\d*\.?\d+\s*\)$/;

const COLOR_KEYS = [
  "background",
  "surface",
  "surface-raised",
  "text",
  "muted",
  "border",
  "border-strong",
  "accent",
  "accent-fg",
  "link",
  "code-bg",
  "code-fg",
  "quote",
  "danger",
  "warning",
  "success",
  "info",
  "selection",
] as const;

const REQUIRED_COLORS = [
  "background",
  "surface",
  "text",
  "muted",
  "border",
  "accent",
  "code-bg",
  "quote",
] as const;

const RADII_KEYS = ["none", "sm", "md", "lg", "xl", "pill", "circle"] as const;
const TYPOGRAPHY_KEYS = [
  "family",
  "stack",
  "mono-stack",
  "base-size",
  "ui-size",
  "small-size",
  "line-height",
  "heading-line-height",
  "code-line-height",
  "weight-normal",
  "weight-bold",
] as const;
const LAYOUT_KEYS = [
  "content-width",
  "sidebar-width",
  "scroll-offset",
  "article-padding-y",
  "article-padding-x",
  "article-padding-bottom",
  "control-height",
  "code-padding",
  "table-cell-padding",
] as const;
const EFFECTS_KEYS = [
  "shadow-panel",
  "overlay",
  "blur",
  "duration-fast",
  "duration-ui",
  "easing",
] as const;

interface Context {
  fileName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(ctx: Context, message: string): never {
  throw new Error(`invalid theme ${ctx.fileName}: ${message}`);
}

function checkKeys(ctx: Context, group: string, raw: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      fail(ctx, `unknown ${group} key ${JSON.stringify(key)}`);
    }
  }
}

function isColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  if (/url\(|var\(|@import|[;{}<>\u0000-\u001f\u007f]/i.test(value)) {
    return false;
  }
  return value === "transparent" || COLOR.test(value) || COLOR_FN.test(value);
}

function color(ctx: Context, group: string, key: string, value: unknown): string {
  if (!isColor(value)) {
    fail(ctx, `${group}.${key} must be a safe CSS color`);
  }
  return value;
}

function safeString(ctx: Context, label: string, value: unknown, max = 512): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || !SAFE_TEXT.test(value)) {
    fail(ctx, `${label} must be a non-empty safe string`);
  }
  return value;
}

function radius(ctx: Context, key: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 9999) {
    fail(ctx, `radii.${key} must be an integer between 0 and 9999`);
  }
  if (["sm", "md", "lg", "xl"].includes(key) && value > 32) {
    fail(ctx, `radii.${key} must be between 0 and 32`);
  }
  return value;
}

function numberIn(ctx: Context, label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    fail(ctx, `${label} must be a number between ${min} and ${max}`);
  }
  return value;
}

function integerIn(ctx: Context, label: string, value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(ctx, `${label} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function length(ctx: Context, label: string, value: unknown): string {
  if (typeof value !== "string" || !LENGTH.test(value)) {
    fail(ctx, `${label} must be a safe CSS length (px, rem, em, %, ch, vw or vh)`);
  }
  return value;
}

function padding(ctx: Context, label: string, value: unknown): string {
  if (typeof value !== "string") {
    fail(ctx, `${label} must be a safe CSS padding`);
  }
  const parts = value.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => !LENGTH.test(part))) {
    fail(ctx, `${label} must be a safe CSS padding`);
  }
  return parts.join(" ");
}

function duration(ctx: Context, label: string, value: unknown): string {
  if (typeof value !== "string") {
    fail(ctx, `${label} must be a CSS duration`);
  }
  const match = DURATION.exec(value);
  if (!match) {
    fail(ctx, `${label} must be a CSS duration in ms or s`);
  }
  const ms = Number(match[1]) * (match[2] === "s" ? 1000 : 1);
  if (!(ms <= 2000)) {
    fail(ctx, `${label} must be at most 2s`);
  }
  return value;
}

function validateColors(ctx: Context, raw: unknown): ThemeColors {
  if (!isRecord(raw)) {
    fail(ctx, "colors must be an object");
  }
  checkKeys(ctx, "colors", raw, COLOR_KEYS);
  for (const key of REQUIRED_COLORS) {
    if (!(key in raw)) {
      fail(ctx, `colors.${key} is required`);
    }
  }
  const out: Partial<ThemeColors> = {};
  for (const key of COLOR_KEYS) {
    if (key in raw) {
      out[key] = color(ctx, "colors", key, raw[key]);
    }
  }
  return out as ThemeColors;
}

function validateRadii(ctx: Context, raw: unknown): ThemeRadii {
  if (!isRecord(raw)) {
    fail(ctx, "radii must be an object");
  }
  checkKeys(ctx, "radii", raw, RADII_KEYS);
  const out: Partial<ThemeRadii> = {};
  for (const key of RADII_KEYS) {
    if (key in raw) {
      out[key] = radius(ctx, key, raw[key]);
    }
  }
  return out as ThemeRadii;
}

function validateTypography(ctx: Context, raw: unknown): ThemeTypography {
  if (!isRecord(raw)) {
    fail(ctx, "typography must be an object");
  }
  checkKeys(ctx, "typography", raw, TYPOGRAPHY_KEYS);
  const out: Partial<ThemeTypography> = {};
  if ("family" in raw) {
    const family = sanitizeFamily(raw.family as string);
    if (!family) {
      fail(ctx, "typography.family must be a safe font family");
    }
    out.family = family;
  }
  if ("stack" in raw) {
    out.stack = safeString(ctx, "typography.stack", raw.stack);
  }
  if ("mono-stack" in raw) {
    out["mono-stack"] = safeString(ctx, "typography.mono-stack", raw["mono-stack"]);
  }
  if ("base-size" in raw) {
    out["base-size"] = numberIn(ctx, "typography.base-size", raw["base-size"], 8, 96);
  }
  if ("ui-size" in raw) {
    out["ui-size"] = numberIn(ctx, "typography.ui-size", raw["ui-size"], 8, 32);
  }
  if ("small-size" in raw) {
    out["small-size"] = numberIn(ctx, "typography.small-size", raw["small-size"], 8, 24);
  }
  for (const key of ["line-height", "heading-line-height", "code-line-height"] as const) {
    if (key in raw) {
      out[key] = numberIn(ctx, `typography.${key}`, raw[key], 0.8, 3);
    }
  }
  if ("weight-normal" in raw) {
    out["weight-normal"] = integerIn(ctx, "typography.weight-normal", raw["weight-normal"], 100, 900);
  }
  if ("weight-bold" in raw) {
    out["weight-bold"] = integerIn(ctx, "typography.weight-bold", raw["weight-bold"], 100, 900);
  }
  return out as ThemeTypography;
}

function validateLayout(ctx: Context, raw: unknown): ThemeLayout {
  if (!isRecord(raw)) {
    fail(ctx, "layout must be an object");
  }
  checkKeys(ctx, "layout", raw, LAYOUT_KEYS);
  const out: Partial<ThemeLayout> = {};
  for (const key of LAYOUT_KEYS) {
    if (key in raw) {
      out[key] = key === "table-cell-padding" ? padding(ctx, `layout.${key}`, raw[key]) : length(ctx, `layout.${key}`, raw[key]);
    }
  }
  return out as ThemeLayout;
}

function validateEffects(ctx: Context, raw: unknown): ThemeEffects {
  if (!isRecord(raw)) {
    fail(ctx, "effects must be an object");
  }
  checkKeys(ctx, "effects", raw, EFFECTS_KEYS);
  const out: Partial<ThemeEffects> = {};
  if ("shadow-panel" in raw) {
    const value = raw["shadow-panel"];
    if (value !== "none" && (typeof value !== "string" || value.length > 200 || !SHADOW.test(value))) {
      fail(ctx, "effects.shadow-panel must be none or a safe CSS shadow");
    }
    out["shadow-panel"] = value as string;
  }
  if ("overlay" in raw) {
    out.overlay = color(ctx, "effects", "overlay", raw.overlay);
  }
  if ("blur" in raw) {
    out.blur = length(ctx, "effects.blur", raw.blur);
  }
  if ("duration-fast" in raw) {
    out["duration-fast"] = duration(ctx, "effects.duration-fast", raw["duration-fast"]);
  }
  if ("duration-ui" in raw) {
    out["duration-ui"] = duration(ctx, "effects.duration-ui", raw["duration-ui"]);
  }
  if ("easing" in raw) {
    const value = raw.easing;
    if (typeof value !== "string" || (!EASING.test(value) && !CUBIC.test(value))) {
      fail(ctx, "effects.easing must be a keyword or cubic-bezier()");
    }
    out.easing = value;
  }
  return out as ThemeEffects;
}

function validateShiki(ctx: Context, raw: unknown): ThemeShiki {
  if (!isRecord(raw)) {
    fail(ctx, "shiki must be an object");
  }
  checkKeys(ctx, "shiki", raw, ["light", "dark"]);
  for (const key of ["light", "dark"] as const) {
    if (typeof raw[key] !== "string" || !(SHIKI_THEME_NAMES as readonly string[]).includes(raw[key] as string)) {
      fail(ctx, `shiki.${key} must be one of: ${SHIKI_THEME_NAMES.join(", ")}`);
    }
  }
  return { light: raw.light as ShikiThemeName, dark: raw.dark as ShikiThemeName };
}

function validateMermaid(ctx: Context, raw: unknown): ThemeMermaid {
  if (!isRecord(raw)) {
    fail(ctx, "mermaid must be an object");
  }
  checkKeys(ctx, "mermaid", raw, ["theme", "overrides"]);
  if (typeof raw.theme !== "string" || !(MERMAID_THEMES as readonly string[]).includes(raw.theme)) {
    fail(ctx, "mermaid.theme is not a known Mermaid theme");
  }
  if (!isRecord(raw.overrides)) {
    fail(ctx, "mermaid.overrides must be an object");
  }
  const entries = Object.entries(raw.overrides);
  if (entries.length > 512) {
    fail(ctx, "mermaid.overrides has too many entries (max 512)");
  }
  const overrides: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!MERMAID_KEY.test(key)) {
      fail(ctx, `mermaid.overrides.${key} is not a valid key`);
    }
    if (typeof value !== "string" || value.length === 0 || value.length > 200 || !SAFE_TEXT.test(value)) {
      fail(ctx, `mermaid.overrides.${key} must be a safe string`);
    }
    overrides[key] = value;
  }
  return { theme: raw.theme as MermaidThemeName, overrides };
}

export function validateTheme(fileName: string, raw: unknown): Theme {
  const ctx: Context = { fileName };
  if (!isRecord(raw)) {
    fail(ctx, "theme must be an object");
  }
  if (!THEME_NAME_RE.test(fileName)) {
    fail(ctx, "theme file name must match ^[a-z0-9][a-z0-9-]{0,63}$");
  }
  checkKeys(ctx, "theme", raw, [
    "$schema",
    "schemaVersion",
    "name",
    "kind",
    "variants",
    "colors",
    "radii",
    "typography",
    "layout",
    "effects",
    "shiki",
    "mermaid",
  ]);
  if (raw.schemaVersion !== 1) {
    fail(ctx, "schemaVersion must be 1");
  }
  if (typeof raw.name !== "string" || raw.name !== fileName) {
    fail(ctx, `name must equal the file name (${fileName})`);
  }
  if (raw.kind === "auto") {
    for (const forbidden of ["colors", "radii", "typography", "layout", "effects", "shiki", "mermaid"]) {
      if (forbidden in raw) {
        fail(ctx, `auto themes cannot define ${forbidden}`);
      }
    }
    if (!isRecord(raw.variants)) {
      fail(ctx, "auto themes require variants");
    }
    const { light, dark } = raw.variants;
    if (typeof light !== "string" || !THEME_NAME_RE.test(light)) {
      fail(ctx, "variants.light must be a theme name");
    }
    if (typeof dark !== "string" || !THEME_NAME_RE.test(dark)) {
      fail(ctx, "variants.dark must be a theme name");
    }
    const auto: AutoTheme = { schemaVersion: 1, name: raw.name, kind: "auto", variants: { light, dark } };
    return auto;
  }
  if (raw.kind !== "light" && raw.kind !== "dark") {
    fail(ctx, "kind must be auto, light or dark");
  }
  if ("variants" in raw) {
    fail(ctx, "fixed themes cannot define variants");
  }
  if (!("colors" in raw)) {
    fail(ctx, "fixed themes require colors");
  }
  if (!("shiki" in raw)) {
    fail(ctx, "fixed themes require shiki");
  }
  if (!("mermaid" in raw)) {
    fail(ctx, "fixed themes require mermaid");
  }
  const colors = validateColors(ctx, raw.colors);
  const radii = "radii" in raw ? validateRadii(ctx, raw.radii) : undefined;
  const typography = "typography" in raw ? validateTypography(ctx, raw.typography) : undefined;
  const layout = "layout" in raw ? validateLayout(ctx, raw.layout) : undefined;
  const effects = "effects" in raw ? validateEffects(ctx, raw.effects) : undefined;
  const normalized = withDefaults(colors, radii, typography, layout, effects);
  const fixed: FixedTheme = {
    schemaVersion: 1,
    name: raw.name,
    kind: raw.kind,
    colors: normalized.colors,
    radii: normalized.radii,
    typography: normalized.typography,
    layout: normalized.layout,
    effects: normalized.effects,
    shiki: validateShiki(ctx, raw.shiki),
    mermaid: validateMermaid(ctx, raw.mermaid),
  };
  return fixed;
}
