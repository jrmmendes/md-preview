import type { EmojiStyle } from "./emoji/constants";
import type { LoaderName } from "./loader";
import type { MermaidThemeName, ShikiThemeName } from "./themes/constants";
export type { LoaderName };

/** Lightweight preset shown in the settings modal for a theme + scheme. */
export interface ThemeCatalogPreset {
  loader: LoaderName;
  font: { family: string; stack: string };
  shiki: { light: ShikiThemeName; dark: ShikiThemeName };
  mermaid: MermaidThemeName;
}

export interface ThemeCatalogEntry {
  name: string;
  kind: "auto" | "light" | "dark";
  /** Where the theme comes from; omitted in old cached payloads. */
  source?: "builtin" | "user";
  swatch: { background: string; text: string; accent: string };
  presets: { light: ThemeCatalogPreset; dark: ThemeCatalogPreset };
}

/** Effective theme data for the client, after per-browser overrides. */
export interface PageThemePayload {
  name: string;
  kind: "auto" | "light" | "dark";
  scheme: "light" | "dark";
  loaders: { light: LoaderName; dark: LoaderName };
  font: { family: string; stack: string };
  shiki: { light: ShikiThemeName; dark: ShikiThemeName };
  mermaidTheme: { light: MermaidThemeName; dark: MermaidThemeName };
}

/** One entry of the dynamic emoji pack catalog shipped to the modal. */
export interface EmojiPackEntry {
  name: string;
  label: string;
  description?: string;
  style: EmojiStyle;
  source: "builtin" | "user";
  count: number;
  license?: string;
  attribution?: string;
}

/** One shortcode/value pair used by the settings preview grid. */
export interface EmojiSample {
  name: string;
  value: string;
  /** Whether `<configDir>/emojis/assets/<pack>/<name>.svg` exists. */
  asset?: boolean;
}

/** Lazy preview payload for `GET /__emoji-samples/<pack>`. */
export interface EmojiSamplesPayload {
  name: string;
  style: EmojiStyle;
  total: number;
  samples: EmojiSample[];
}

/** Effective emoji pack for the rendered page. */
export interface PageEmojiPayload {
  name: string;
  style: EmojiStyle;
}

/** SSE payload for emoji packs added/edited/removed on disk. */
export interface EmojisEvent {
  names: string[];
  changed: string[];
  version: number;
}

/** Read-only daemon settings shown on the modal's System page. */
export interface PageConfigPayload {
  port: number;
  idleMinutes: number;
  seedThemes: boolean;
  paths: { config: string; themes: string; emojis: string; state: string };
}

export interface PageInput {
  title: string;
  body: string;
  themeName: string;
  loader: LoaderName;
  /**
   * Loader precedence from `Config`. When omitted (default), the theme preset
   * wins over `loader`, which is what the daemon wants unless the user or
   * `config.json` chose explicitly.
   */
  loaderFrom?: "env" | "file" | "default";
  zoomSensitivity: number;
  meta?: Record<string, unknown>;
  /** Raw Markdown source (frontmatter included) sent to the client payload. */
  raw?: string;
}

export type FontCategory = "sans" | "serif" | "monospace" | "script" | "unknown";

export interface FontInfo {
  family: string;
  styles: string[];
  category: FontCategory;
}

export interface FontsPayload {
  available: boolean;
  source: "system" | "fallback";
  fonts: FontInfo[];
  generatedAt: string;
  total: number;
}

export interface SlugInfo {
  slug: string;
  path: string;
  title: string;
}

export interface SnapshotEvent {
  versions: Record<string, number>;
  slugs: SlugInfo[];
}

export interface VersionEvent {
  slug: string;
  version: number;
}

export type SlugsEvent = SlugInfo[];

/**
 * Sent to connected preview tabs when the CLI wants a document shown without
 * opening a new tab. `slug` is the target document; `url` is a same-origin
 * path (or absolute URL) the tab should navigate to when needed.
 */
export interface ActivateEvent {
  slug: string;
  url: string;
  ts: number;
}

export interface ThemesEvent {
  names: string[];
  changed: string[];
  version: number;
}

/** One entry of the dynamic Shiki catalog shipped to the modal. */
export interface ShikiThemeEntry {
  name: string;
  label: string;
  kind: "light" | "dark";
  source: "builtin" | "custom";
}

/** One entry of the dynamic Mermaid catalog shipped to the modal. */
export interface MermaidThemeEntry {
  name: string;
  label: string;
  source: "builtin" | "custom";
  /** Base Mermaid theme used with the variables. */
  theme: MermaidThemeName;
  variables: Record<string, string>;
}

/** SSE payload for imported Shiki themes added/edited/removed on disk. */
export interface ShikiThemesEvent {
  names: string[];
  changed: string[];
  version: number;
}

/** SSE payload for imported Mermaid themes added/edited/removed on disk. */
export interface MermaidThemesEvent {
  names: string[];
  changed: string[];
  version: number;
}

