/**
 * Runtime validator for emoji packs (`<configDir>/emojis/<slug>.json`).
 *
 * This module is the authoritative contract; `emojis/emoji.schema.json` only
 * documents it for editors. Unknown keys are rejected so typos do not pass
 * silently, and every shortcode value is classified as either an inline SVG
 * data URI or a short Unicode emoji sequence.
 */
import { THEME_NAME_RE } from "../themes/constants";
import {
  EMOJI_SHORTCODE_RE,
  MAX_EMOJI_DATA_URI_BYTES,
  MAX_EMOJI_SEQUENCE_CODE_POINTS,
  MAX_EMOJI_SHORTCODES,
  isEmojiSlug,
  isEmojiStyle,
  type EmojiStyle,
} from "./constants";
import { DEFAULT_EMOJI_STYLE, emojiPackId } from "./defaults";
import type { EmojiPack } from "./types";

const ROOT_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "name",
  "label",
  "description",
  "style",
  "shortcodes",
  "license",
  "attribution",
]);

const SAFE_TEXT = /^[^<>\\\u0000-\u001f\u007f]+$/;
const SVG_DATA_URI = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/i;
const ANY_DATA_URI = /^data:/i;

/** One allowed code point of an emoji sequence. */
const EMOJI_PART =
  /^(?:\p{Extended_Pictographic}|[\u0023\u002a\u0030-\u0039\u200d\u20e3\ufe0e\ufe0f\u{1f1e6}-\u{1f1ff}\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}])$/u;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const REGIONAL = /[\u{1f1e6}-\u{1f1ff}]/u;
const KEYCAP = /\u20e3/u;

export type EmojiPackErrorCode = "invalid" | "too-many" | "too-large" | "exists";

export class EmojiPackError extends Error {
  constructor(
    public readonly code: EmojiPackErrorCode,
    message: string
  ) {
    super(message);
    this.name = "EmojiPackError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new EmojiPackError("invalid", message);
}

function safeText(value: unknown, label: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || !SAFE_TEXT.test(value)) {
    fail(`${label} must be a non-empty safe string of at most ${max} characters`);
  }
  return value;
}

function optionalText(raw: Record<string, unknown>, key: string, max: number): string | undefined {
  if (!(key in raw)) {
    return undefined;
  }
  return safeText(raw[key], key, max);
}

function codePoints(value: string): string[] {
  return [...value];
}

function validateValue(shortcode: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    fail(`shortcodes.${shortcode} must be a non-empty string`);
  }
  const data = SVG_DATA_URI.exec(value);
  if (data) {
    const decoded = Buffer.from(data[1]!, "base64");
    if (decoded.byteLength === 0) {
      fail(`shortcodes.${shortcode} data URI is empty`);
    }
    if (decoded.byteLength > MAX_EMOJI_DATA_URI_BYTES) {
      throw new EmojiPackError(
        "too-large",
        `shortcodes.${shortcode} data URI is larger than ${MAX_EMOJI_DATA_URI_BYTES / 1024} KiB`
      );
    }
    return value;
  }
  if (ANY_DATA_URI.test(value)) {
    fail(`shortcodes.${shortcode} must use a base64 image/svg+xml data URI`);
  }
  const points = codePoints(value);
  if (points.length === 0 || points.length > MAX_EMOJI_SEQUENCE_CODE_POINTS) {
    fail(
      `shortcodes.${shortcode} must be 1 to ${MAX_EMOJI_SEQUENCE_CODE_POINTS} Unicode code points`
    );
  }
  for (const point of points) {
    if (!EMOJI_PART.test(point)) {
      fail(`shortcodes.${shortcode} contains a non-emoji code point`);
    }
  }
  if (!PICTOGRAPHIC.test(value) && !REGIONAL.test(value) && !KEYCAP.test(value)) {
    fail(`shortcodes.${shortcode} is not an emoji sequence`);
  }
  return value;
}

function validateShortcodes(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    fail("shortcodes must be an object");
  }
  const entries = Object.entries(raw);
  if (entries.length > MAX_EMOJI_SHORTCODES) {
    throw new EmojiPackError(
      "too-many",
      `shortcodes has too many entries (max ${MAX_EMOJI_SHORTCODES})`
    );
  }
  const shortcodes: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!EMOJI_SHORTCODE_RE.test(name)) {
      fail(`shortcode name ${JSON.stringify(name)} must match ^(x|[a-z0-9_+-]{2,64})$`);
    }
    shortcodes[name] = validateValue(name, value);
  }
  return shortcodes;
}

/**
 * Validates a pack against the runtime contract. `fileName` is the slug taken
 * from the file name, so a pack can never claim a path of its own.
 */
export function validateEmojiPack(fileName: string, raw: unknown): EmojiPack {
  if (!isEmojiSlug(fileName)) {
    fail(`emoji pack file name ${JSON.stringify(fileName)} must match ${THEME_NAME_RE.source}`);
  }
  if (!isRecord(raw)) {
    fail("emoji pack must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      fail(`unknown emoji pack key ${JSON.stringify(key)}`);
    }
  }
  if (raw.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  if (typeof raw.name !== "string" || raw.name !== fileName) {
    fail(`name must equal the file name (${fileName})`);
  }
  let style: EmojiStyle = DEFAULT_EMOJI_STYLE;
  if ("style" in raw) {
    if (!isEmojiStyle(raw.style)) {
      fail('style must be "twemoji", "noto" or "native"');
    }
    style = raw.style;
  }
  const label = optionalText(raw, "label", 128);
  const description = optionalText(raw, "description", 512);
  const license = optionalText(raw, "license", 128);
  const attribution = optionalText(raw, "attribution", 256);
  const shortcodes = validateShortcodes(raw.shortcodes);

  const pack: EmojiPack = {
    schemaVersion: 1,
    name: fileName,
    style,
    shortcodes,
    id: emojiPackId(style, shortcodes),
  };
  if (label !== undefined) pack.label = label;
  if (description !== undefined) pack.description = description;
  if (license !== undefined) pack.license = license;
  if (attribution !== undefined) pack.attribution = attribution;
  return pack;
}
