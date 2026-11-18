export type LoaderName = "classic" | "dots" | "bars" | "ring" | "pulse" | "braille";

export interface PageInput {
  title: string;
  body: string;
  themeName: string;
  loader: LoaderName;
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

