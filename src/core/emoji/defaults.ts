import { createHash } from "node:crypto";

import type { EmojiStyle } from "./constants";

export const DEFAULT_EMOJI_STYLE: EmojiStyle = "native";

/** Human label used when a pack omits `label`. */
export function emojiLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Content-addressed id embedded in the renderer cache key. Style is included
 * so switching `native` -> `twemoji` invalidates renderers even when the
 * shortcode table itself is unchanged.
 */
export function emojiPackId(style: EmojiStyle, shortcodes: Record<string, string>): string {
  return createHash("sha1")
    .update(JSON.stringify({ style, shortcodes }))
    .digest("hex")
    .slice(0, 8);
}
