export type LoaderName = "classic" | "dots" | "bars" | "ring" | "pulse" | "braille";

export interface PageInput {
  title: string;
  body: string;
  themeName: string;
  loader: LoaderName;
  zoomSensitivity: number;
  meta?: Record<string, unknown>;
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
