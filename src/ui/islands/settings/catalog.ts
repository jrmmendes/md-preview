/**
 * Resolução de presets do catálogo (`#mdprv-data.catalog`) e dos blocos
 * personalizáveis. Sem DOM: o modal apenas renderiza o resultado.
 */
import type { LoaderName } from "../../../core/loader";
import { isEmojiStyle } from "../../../core/emoji/constants";
import type { MermaidThemeName, ShikiThemeName } from "../../../core/themes/constants";
import { THEME_PREFS_BLOCKS_KEY } from "../../../shared/theme-prefs";
import type {
  EmojiPackEntry,
  MermaidThemeEntry,
  PageConfigPayload,
  PageEmojiPayload,
  PageThemePayload,
  ShikiThemeEntry,
  ThemeCatalogEntry,
  ThemeCatalogPreset,
} from "../../../core/contract";

export const BLOCK_IDS = ["fonte", "loader", "codigo", "graficos"] as const;

export const BLOCKS_STORAGE_KEY = THEME_PREFS_BLOCKS_KEY;

export type BlockId = (typeof BLOCK_IDS)[number];

export type Blocks = Record<BlockId, boolean>;

export type Scheme = "light" | "dark";

export interface FontValue {
  family: string;
  stack: string;
  source: "local" | "google";
}

export interface ShikiValue {
  light: ShikiThemeName;
  dark: ShikiThemeName;
}

export interface MermaidValue {
  light: MermaidThemeName;
  dark: MermaidThemeName;
}

export interface StoredValues {
  font: FontValue | null;
  loader: LoaderName | null;
  shiki: ShikiValue | null;
  mermaid: MermaidValue | null;
}

export interface PageThemeData {
  theme: PageThemePayload;
  catalog: ThemeCatalogEntry[];
  shikiThemes: ShikiThemeEntry[];
  mermaidThemes?: MermaidThemeEntry[];
  /** Pack resolved for this request; absent in pages cached before Phase A. */
  emoji?: PageEmojiPayload | null;
  emojis: EmojiPackEntry[];
  config?: PageConfigPayload | null;
}

export interface BlockState<T> {
  customized: boolean;
  value: T;
}

export interface ResolvedBlocks {
  fonte: BlockState<FontValue>;
  loader: BlockState<LoaderName>;
  codigo: BlockState<ShikiValue>;
  graficos: BlockState<MermaidValue>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPreset(value: unknown): value is ThemeCatalogPreset {
  if (!isRecord(value)) {
    return false;
  }
  const font = value.font;
  const shiki = value.shiki;
  return (
    typeof value.loader === "string" &&
    isRecord(font) &&
    typeof font.family === "string" &&
    typeof font.stack === "string" &&
    isRecord(shiki) &&
    typeof shiki.light === "string" &&
    typeof shiki.dark === "string" &&
    typeof value.mermaid === "string"
  );
}

function isCatalogEntry(value: unknown): value is ThemeCatalogEntry {
  if (!isRecord(value) || typeof value.name !== "string") {
    return false;
  }
  if (value.kind !== "auto" && value.kind !== "light" && value.kind !== "dark") {
    return false;
  }
  const swatch = value.swatch;
  const presets = value.presets;
  if (!isRecord(swatch) || !isRecord(presets)) {
    return false;
  }
  if (
    typeof swatch.background !== "string" ||
    typeof swatch.text !== "string" ||
    typeof swatch.accent !== "string"
  ) {
    return false;
  }
  return isPreset(presets.light) && isPreset(presets.dark);
}

function isConfig(value: unknown): value is PageConfigPayload {
  if (!isRecord(value)) {
    return false;
  }
  const paths = value.paths;
  return (
    typeof value.port === "number" &&
    typeof value.idleMinutes === "number" &&
    typeof value.seedThemes === "boolean" &&
    isRecord(paths) &&
    typeof paths.config === "string" &&
    typeof paths.themes === "string" &&
    typeof paths.emojis === "string" &&
    typeof paths.state === "string"
  );
}

function isEmojiEntry(value: unknown): value is EmojiPackEntry {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    isEmojiStyle(value.style) &&
    (value.source === "builtin" || value.source === "user") &&
    typeof value.count === "number" &&
    Number.isFinite(value.count) &&
    value.count >= 0 &&
    (value.description === undefined || typeof value.description === "string") &&
    (value.license === undefined || typeof value.license === "string") &&
    (value.attribution === undefined || typeof value.attribution === "string")
  );
}

function isEmojiPayload(value: unknown): value is PageEmojiPayload {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isEmojiStyle(value.style)
  );
}

/** Keeps only well-formed catalog entries; used by the page payload and sync. */
export function parseEmojiEntries(raw: unknown): EmojiPackEntry[] {
  return Array.isArray(raw) ? raw.filter(isEmojiEntry) : [];
}

function isShikiEntry(value: unknown): value is ShikiThemeEntry {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.label === "string" &&
    (value.kind === "light" || value.kind === "dark") &&
    (value.source === "builtin" || value.source === "custom")
  );
}

function isMermaidEntry(value: unknown): value is MermaidThemeEntry {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.label !== "string" ||
    (value.source !== "builtin" && value.source !== "custom") ||
    typeof value.theme !== "string" ||
    !isRecord(value.variables)
  ) {
    return false;
  }
  return Object.values(value.variables).every((item) => typeof item === "string");
}

export function parsePageThemeData(raw: unknown): PageThemeData | null {
  if (!isRecord(raw)) {
    return null;
  }
  const theme = raw.theme;
  if (
    !isRecord(theme) ||
    typeof theme.name !== "string" ||
    (theme.kind !== "auto" && theme.kind !== "light" && theme.kind !== "dark") ||
    (theme.scheme !== "light" && theme.scheme !== "dark")
  ) {
    return null;
  }
  if (!Array.isArray(raw.catalog)) {
    return null;
  }
  const catalog = raw.catalog.filter(isCatalogEntry);
  if (catalog.length === 0) {
    return null;
  }
  const config = isConfig(raw.config) ? raw.config : null;
  const shikiThemes = Array.isArray(raw.shikiThemes)
    ? raw.shikiThemes.filter(isShikiEntry)
    : [];
  const mermaidThemes = Array.isArray(raw.mermaidThemes)
    ? raw.mermaidThemes.filter(isMermaidEntry)
    : [];
  return {
    theme: theme as unknown as PageThemePayload,
    catalog,
    shikiThemes,
    mermaidThemes,
    emoji: isEmojiPayload(raw.emoji) ? raw.emoji : null,
    emojis: parseEmojiEntries(raw.emojis),
    config,
  };
}

export function blocksFrom(value: unknown): Blocks {
  const record = isRecord(value) ? value : {};
  return {
    fonte: record.fonte === true,
    loader: record.loader === true,
    codigo: record.codigo === true,
    graficos: record.graficos === true,
  };
}

export function findCatalogEntry(
  data: PageThemeData,
  name: string
): ThemeCatalogEntry | undefined {
  return data.catalog.find((entry) => entry.name === name);
}

export function entryScheme(entry: ThemeCatalogEntry, prefersDark: boolean): Scheme {
  if (entry.kind === "auto") {
    return prefersDark ? "dark" : "light";
  }
  return entry.kind;
}

export function currentScheme(prefersDark: boolean): Scheme {
  return prefersDark ? "dark" : "light";
}

/** Preset of a theme for one scheme; fixed themes pin their own kind. */
export function presetFor(
  data: PageThemeData,
  name: string,
  scheme: Scheme
): ThemeCatalogPreset | undefined {
  const entry = findCatalogEntry(data, name) ?? findCatalogEntry(data, "auto");
  if (!entry) {
    return undefined;
  }
  if (entry.kind === "auto") {
    return entry.presets[scheme];
  }
  return entry.presets[entry.kind];
}

export function resolvePresets(
  data: PageThemeData,
  name: string,
  scheme: Scheme
): { light: ThemeCatalogPreset; dark: ThemeCatalogPreset } | null {
  const light = presetFor(data, name, "light");
  const dark = presetFor(data, name, "dark");
  if (!light || !dark) {
    return null;
  }
  return { light, dark };
}

export const SHIKI_FALLBACK: ShikiValue = {
  light: "github-light",
  dark: "github-dark",
};

/**
 * Keeps only names present in the dynamic catalog, falling back per slot.
 * An empty catalog (cached HTML from before the feature) is left untouched and
 * the menus are disabled by the page.
 */
export function sanitizeShikiValue(
  value: ShikiValue,
  themes: ShikiThemeEntry[],
  fallback: ShikiValue = SHIKI_FALLBACK
): ShikiValue {
  if (themes.length === 0) {
    return { ...value };
  }
  const known = new Set(themes.map((theme) => theme.name));
  const pick = (face: Scheme): string => {
    if (known.has(value[face])) {
      return value[face];
    }
    if (known.has(fallback[face])) {
      return fallback[face];
    }
    return SHIKI_FALLBACK[face];
  };
  return { light: pick("light"), dark: pick("dark") };
}

export const MERMAID_FALLBACK: MermaidValue = {
  light: "default",
  dark: "default",
};

/**
 * Keeps only names present in the dynamic Mermaid catalog, falling back per
 * slot. An empty catalog (cached HTML from before the feature) is left
 * untouched and the menus are disabled by the page.
 */
export function sanitizeMermaidValue(
  value: MermaidValue,
  themes: MermaidThemeEntry[],
  fallback: MermaidValue = MERMAID_FALLBACK
): MermaidValue {
  if (themes.length === 0) {
    return { ...value };
  }
  const known = new Set(themes.map((theme) => theme.name));
  const pick = (face: Scheme): string => {
    if (known.has(value[face])) {
      return value[face];
    }
    if (known.has(fallback[face])) {
      return fallback[face];
    }
    return MERMAID_FALLBACK[face];
  };
  return { light: pick("light"), dark: pick("dark") };
}

export function resolveBlocks(input: {
  blocks: Blocks;
  stored: StoredValues;
  presets: { light: ThemeCatalogPreset; dark: ThemeCatalogPreset };
  scheme: Scheme;
  shikiThemes: ShikiThemeEntry[];
  mermaidThemes?: MermaidThemeEntry[];
}): ResolvedBlocks {
  const { blocks, stored, presets, scheme, shikiThemes } = input;
  const mermaidThemes = input.mermaidThemes ?? [];
  const effective = presets[scheme];
  const presetFont: FontValue = {
    family: effective.font.family,
    stack: effective.font.stack,
    source: "local",
  };
  const presetShiki = sanitizeShikiValue(
    {
      light: presets.light.shiki.light,
      dark: presets.dark.shiki.dark,
    },
    shikiThemes
  );
  const presetMermaid = sanitizeMermaidValue(
    {
      light: presets.light.mermaid,
      dark: presets.dark.mermaid,
    },
    mermaidThemes
  );
  return {
    fonte: {
      customized: blocks.fonte,
      value: blocks.fonte && stored.font ? stored.font : presetFont,
    },
    loader: {
      customized: blocks.loader,
      value: blocks.loader && stored.loader ? stored.loader : effective.loader,
    },
    codigo: {
      customized: blocks.codigo,
      value:
        blocks.codigo && stored.shiki
          ? sanitizeShikiValue(stored.shiki, shikiThemes, presetShiki)
          : presetShiki,
    },
    graficos: {
      customized: blocks.graficos,
      value:
        blocks.graficos && stored.mermaid
          ? sanitizeMermaidValue(stored.mermaid, mermaidThemes, presetMermaid)
          : presetMermaid,
    },
  };
}

/** Values written when a block is customized (or restored), per preset. */
export function presetValues(
  block: BlockId,
  presets: { light: ThemeCatalogPreset; dark: ThemeCatalogPreset },
  scheme: Scheme
): Partial<StoredValues> {
  switch (block) {
    case "fonte":
      return {
        font: {
          family: presets[scheme].font.family,
          stack: presets[scheme].font.stack,
          source: "local",
        },
      };
    case "loader":
      return { loader: presets[scheme].loader };
    case "codigo":
      return {
        shiki: {
          light: presets.light.shiki.light,
          dark: presets.dark.shiki.dark,
        },
      };
    case "graficos":
      return {
        mermaid: {
          light: presets.light.mermaid,
          dark: presets.dark.mermaid,
        },
      };
  }
}

const NAMED_THEMES: Record<string, string> = {
  auto: "Auto",
  github: "Github",
  gruvbox: "Gruvbox",
  solarized: "Solarized",
};

export function themeLabel(name: string): string {
  return name
    .split("-")
    .map((part, index) => {
      if (index === 0) {
        return NAMED_THEMES[part] ?? part.charAt(0).toUpperCase() + part.slice(1);
      }
      return part;
    })
    .join(" ");
}

export function loaderLabel(name: LoaderName): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
