/**
 * Runtime validator for icon packs (`<configDir>/icons/<slug>.json`).
 *
 * This module is the authoritative contract; `icons/icon.schema.json` only
 * documents it for editors. Unknown root keys and unknown icon keys are
 * rejected so typos do not pass silently. Every icon value is classified as
 * either a safe relative SVG path or an inline base64 SVG data URI.
 */
import { THEME_NAME_RE } from "../themes/constants";
import {
  ICON_KEYS,
  ICON_PATH_RE,
  MAX_ICON_DATA_URI_BYTES,
  isIconKey,
  isIconSlug,
  isIconStyle,
  type IconKey,
  type IconStyle,
} from "./constants";
import { DEFAULT_ICON_STYLE, iconPackId } from "./defaults";
import type { IconPack } from "./types";

const ROOT_KEYS = new Set([
  "$schema",
  "schemaVersion",
  "name",
  "label",
  "description",
  "style",
  "icons",
  "license",
  "attribution",
]);

const SAFE_TEXT = /^[^<>\\\u0000-\u001f\u007f]+$/;
const SVG_DATA_URI = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/i;
const ANY_DATA_URI = /^data:/i;

export type IconPackErrorCode = "invalid" | "too-many" | "too-large" | "exists";

export class IconPackError extends Error {
  constructor(
    public readonly code: IconPackErrorCode,
    message: string
  ) {
    super(message);
    this.name = "IconPackError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new IconPackError("invalid", message);
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

function validateValue(key: string, value: unknown): string {
  if (typeof value !== "string" || value === "") {
    fail(`icons.${key} must be a non-empty string`);
  }
  const data = SVG_DATA_URI.exec(value);
  if (data) {
    const decoded = Buffer.from(data[1]!, "base64");
    if (decoded.byteLength === 0) {
      fail(`icons.${key} data URI is empty`);
    }
    if (decoded.byteLength > MAX_ICON_DATA_URI_BYTES) {
      throw new IconPackError(
        "too-large",
        `icons.${key} data URI is larger than ${MAX_ICON_DATA_URI_BYTES / 1024} KiB`
      );
    }
    return value;
  }
  if (ANY_DATA_URI.test(value)) {
    fail(`icons.${key} must use a base64 image/svg+xml data URI`);
  }
  if (!ICON_PATH_RE.test(value)) {
    fail(`icons.${key} must match ${ICON_PATH_RE.source}`);
  }
  return value;
}

function validateIcons(raw: unknown): Partial<Record<IconKey, string>> {
  if (!isRecord(raw)) {
    fail("icons must be an object");
  }
  const entries = Object.entries(raw);
  if (entries.length > ICON_KEYS.length) {
    throw new IconPackError(
      "too-many",
      `icons has too many entries (max ${ICON_KEYS.length})`
    );
  }
  const icons: Partial<Record<IconKey, string>> = {};
  for (const [name, value] of entries) {
    if (!isIconKey(name)) {
      fail(`unknown icon key ${JSON.stringify(name)}`);
    }
    icons[name] = validateValue(name, value);
  }
  if (Object.keys(icons).length === 0) {
    fail("icons must define at least one key");
  }
  return icons;
}

/**
 * Validates a pack against the runtime contract. `fileName` is the slug taken
 * from the file name, so a pack can never claim a path of its own.
 */
export function validateIconPack(fileName: string, raw: unknown): IconPack {
  if (!isIconSlug(fileName)) {
    fail(`icon pack file name ${JSON.stringify(fileName)} must match ${THEME_NAME_RE.source}`);
  }
  if (!isRecord(raw)) {
    fail("icon pack must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      fail(`unknown icon pack key ${JSON.stringify(key)}`);
    }
  }
  if (raw.schemaVersion !== 1) {
    fail("schemaVersion must be 1");
  }
  if (typeof raw.name !== "string" || raw.name !== fileName) {
    fail(`name must equal the file name (${fileName})`);
  }
  let style: IconStyle = DEFAULT_ICON_STYLE;
  if ("style" in raw) {
    if (!isIconStyle(raw.style)) {
      fail('style must be "symbolic" or "fullcolor"');
    }
    style = raw.style;
  }
  const label = optionalText(raw, "label", 128);
  const description = optionalText(raw, "description", 512);
  const license = optionalText(raw, "license", 128);
  const attribution = optionalText(raw, "attribution", 256);
  const icons = validateIcons(raw.icons);

  const pack: IconPack = {
    schemaVersion: 1,
    name: fileName,
    style,
    icons,
    id: iconPackId(style, icons),
  };
  if (label !== undefined) pack.label = label;
  if (description !== undefined) pack.description = description;
  if (license !== undefined) pack.license = license;
  if (attribution !== undefined) pack.attribution = attribution;
  return pack;
}
