import { THEME_NAME_RE } from "../themes/constants";

/** Builtin pack used when no query/cookie/config selection resolves. */
export const DEFAULT_ICON_PACK = "breeze";

/**
 * Old (pre-schema) single-pack file name. Never loaded, never listed: a
 * leftover `default.json` is reported and ignored so it cannot shadow the
 * builtin pack or affect selection.
 */
export const LEGACY_ICON_PACK = "default";

/**
 * Names owned by the application. A user file with one of these slugs is
 * ignored (with an error entry) and the embedded pack always wins, so the
 * builtin default can never be shadowed.
 */
export const RESERVED_ICON_PACKS: readonly string[] = [DEFAULT_ICON_PACK, LEGACY_ICON_PACK];

export function isReservedIconPack(value: unknown): boolean {
  return typeof value === "string" && RESERVED_ICON_PACKS.includes(value);
}

export const ICON_DIR_NAME = "icons";

export const ICON_SCHEMA_FILE = "icon.schema.json";

/**
 * Same cap as the theme/emoji import pipeline: the body is streamed and
 * aborted as soon as it crosses this many bytes.
 */
export const MAX_ICON_FILE_BYTES = 256 * 1024;

export const MAX_ICON_PACKS = 100;

/** Decoded byte cap for one inline `data:image/svg+xml;base64,...` value. */
export const MAX_ICON_DATA_URI_BYTES = 32 * 1024;

export const ICON_STYLES = ["symbolic", "fullcolor"] as const;

export type IconStyle = (typeof ICON_STYLES)[number];

export function isIconStyle(value: unknown): value is IconStyle {
  return typeof value === "string" && (ICON_STYLES as readonly string[]).includes(value);
}

/**
 * Closed set of icon keys the application renders today. Unknown keys are a
 * validation error (422) so a typo in a pack never silently produces an empty
 * glyph. Order is canonical: it is used for the generated CSS and the builtin
 * asset module.
 */
export const ICON_KEYS = [
  // copy / check
  "copy",
  "check",
  "csv",
  // table toolbar
  "filter",
  "funnel",
  "sort",
  "pivot",
  "header-row",
  "header-col",
  "chart",
  "fullscreen",
  // tree
  "chevron",
  "chevron-down",
  "folder",
  "file",
  // shell / chrome
  "close",
  "settings",
  "sidebar",
  "history",
  "top",
  "zen",
  "zen-exit",
  // settings modal
  "palette",
  "terminal",
  "activity",
  "smile",
  "table",
  "code",
  "diff",
  "layers",
  "info",
  "reset",
  "pencil",
  "trash",
  "import",
  "save",
  // chart kind previews
  "chart-bar",
  "chart-hbar",
  "chart-line",
  "chart-area",
  "chart-pie",
  "chart-scatter",
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

const ICON_KEY_SET: ReadonlySet<string> = new Set(ICON_KEYS);

export function isIconKey(value: unknown): value is IconKey {
  return typeof value === "string" && ICON_KEY_SET.has(value);
}

/** Pack file names share the theme slug syntax. */
export function isIconSlug(value: unknown): value is string {
  return typeof value === "string" && THEME_NAME_RE.test(value);
}

/**
 * Manifest asset path: relative, lowercase, no `..`, no absolute path and no
 * scheme. Dots are only allowed in the final `.svg` extension.
 */
export const ICON_PATH_RE = /^[a-z0-9][a-z0-9_/-]*\.svg$/;

export function iconFileName(name: string): string {
  return `${name}.json`;
}

/** CSS custom property that carries one resolved mask URL. */
export function iconCssVar(key: IconKey): string {
  return `--mdprv-icon-${key}`;
}

/** Daemon route used by the emitted custom properties. */
export function iconAssetUrl(pack: string, key: IconKey): string {
  return `/__icon-assets/${pack}/${key}.svg`;
}
