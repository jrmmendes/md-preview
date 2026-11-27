import type { EmojiStyle } from "./constants";

/**
 * Normalized emoji pack. `id` is a content hash used by the renderer cache and
 * is never accepted from user JSON (`$schema`, `id` and friends are rejected by
 * the validator).
 */
export interface EmojiPack {
  schemaVersion: 1;
  name: string;
  label?: string;
  description?: string;
  style: EmojiStyle;
  shortcodes: Record<string, string>;
  license?: string;
  attribution?: string;
  id: string;
}

/** Catalog entry exposed to the CLI, the daemon API and the page payload. */
export interface EmojiPackInfo {
  name: string;
  label: string;
  description?: string;
  style: EmojiStyle;
  source: "builtin" | "user";
  count: number;
  license?: string;
  attribution?: string;
}

export interface EmojiError {
  file: string;
  message: string;
}
