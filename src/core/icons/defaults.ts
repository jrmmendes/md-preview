import { createHash } from "node:crypto";

import type { IconKey, IconStyle } from "./constants";

export const DEFAULT_ICON_STYLE: IconStyle = "symbolic";

/** Human label used when a pack omits `label`. */
export function iconLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Content-addressed id embedded in the page payload/cache key. Style is
 * included so switching `symbolic` -> `fullcolor` invalidates renderers even
 * when the icon table itself is unchanged.
 */
export function iconPackId(
  style: IconStyle,
  icons: Partial<Record<IconKey, string>>
): string {
  return createHash("sha1")
    .update(JSON.stringify({ style, icons }))
    .digest("hex")
    .slice(0, 8);
}

/**
 * Last-resort glyph used when neither the active pack nor the builtin pack
 * provides a key. A generic rounded square keeps the layout stable instead of
 * leaving a mask that 404s (which would paint a solid square).
 */
export const FALLBACK_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"><rect x="4" y="4" width="14" height="14" rx="3" fill="currentColor" opacity=".35"/></svg>';
