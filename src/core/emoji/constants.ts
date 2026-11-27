import { THEME_NAME_RE } from "../themes/constants";

/** Builtin pack used when no query/cookie/config selection resolves. */
export const DEFAULT_EMOJI_PACK = "github";

export const EMOJI_DIR_NAME = "emojis";

export const EMOJI_SCHEMA_FILE = "emoji.schema.json";

export const EMOJI_ASSETS_DIR_NAME = "assets";

/**
 * Same cap as the theme import pipeline: the body is streamed and aborted as
 * soon as it crosses this many bytes.
 */
export const MAX_EMOJI_FILE_BYTES = 256 * 1024;

export const MAX_EMOJI_PACKS = 100;

export const MAX_EMOJI_SHORTCODES = 2_000;

/** Decoded byte cap for one inline `data:image/svg+xml;base64,...` value. */
export const MAX_EMOJI_DATA_URI_BYTES = 32 * 1024;

/** A shortcode value has at most 8 Unicode code points. */
export const MAX_EMOJI_SEQUENCE_CODE_POINTS = 8;

/**
 * GitHub-style shortcode names (`+1`, `-1`, `white_check_mark`, ...).
 *
 * GitHub also exposes the single-letter `x` alias, so it is the only 1-char
 * name accepted; every other shortcode is 2..64 characters.
 */
export const EMOJI_SHORTCODE_RE = /^(?:x|[a-z0-9_+-]{2,64})$/;

export const EMOJI_SHORTCODE_PATTERN = "(?:x|[a-z0-9_+-]{2,64})";

export const EMOJI_STYLES = ["twemoji", "noto", "native"] as const;

export type EmojiStyle = (typeof EMOJI_STYLES)[number];

export function isEmojiStyle(value: unknown): value is EmojiStyle {
  return typeof value === "string" && (EMOJI_STYLES as readonly string[]).includes(value);
}

/** Pack file names share the theme slug syntax. */
export function isEmojiSlug(value: unknown): value is string {
  return typeof value === "string" && THEME_NAME_RE.test(value);
}

export function emojiFileName(name: string): string {
  return `${name}.json`;
}

export function emojiAssetFileName(shortcode: string): string {
  return `${shortcode}.svg`;
}
