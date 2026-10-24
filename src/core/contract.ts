export type LoaderName = "classic" | "dots" | "bars" | "ring" | "pulse" | "braille";

export interface PageInput {
  title: string;
  body: string;
  themeName: string;
  loader: LoaderName;
  zoomSensitivity: number;
  meta?: Record<string, unknown>;
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

export interface ThemesEvent {
  names: string[];
  changed: string[];
  version: number;
}

