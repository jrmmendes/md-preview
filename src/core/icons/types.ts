import type { IconKey, IconStyle } from "./constants";

/**
 * Normalized icon pack. `id` is a content hash used by the renderer/page cache
 * and is never accepted from user JSON (`$schema`, `id` and friends are
 * rejected by the validator).
 *
 * Each value is either a relative SVG path (resolved against the icons
 * directory) or a base64 `data:image/svg+xml` URI.
 */
export interface IconPack {
  schemaVersion: 1;
  name: string;
  label?: string;
  description?: string;
  style: IconStyle;
  icons: Partial<Record<IconKey, string>>;
  license?: string;
  attribution?: string;
  id: string;
}

/** Catalog entry exposed to the CLI, the daemon API and the page payload. */
export interface IconPackInfo {
  name: string;
  label: string;
  description?: string;
  style: IconStyle;
  source: "builtin" | "user";
  count: number;
  /** True for the reserved builtin default pack (`breeze`). */
  default?: boolean;
  license?: string;
  attribution?: string;
}

export interface IconError {
  file: string;
  message: string;
}
