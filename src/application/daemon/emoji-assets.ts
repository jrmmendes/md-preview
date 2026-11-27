/**
 * `GET /__emoji-assets/<pack>/<file>`: serves an SVG from
 * `<configDir>/emojis/assets/<pack>/`.
 *
 * Only `.svg` files with a validated shortcode name are accepted; the pack
 * slug must exist in the store. Path traversal, symlinks and non-regular files
 * are rejected with 404 so the client can silently fall back to the Unicode
 * glyph.
 */
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import { EMOJI_SHORTCODE_PATTERN } from "../../core/emoji/constants";
import type { EmojiStore } from "../../core/emoji/store";
import { baseHeaders } from "./headers";

const SVG_FILE_RE = new RegExp(`^(${EMOJI_SHORTCODE_PATTERN})\\.svg$`);

function notFound(head = false): Response {
  return new Response(head ? null : "not found", {
    status: 404,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

export function serveEmojiAsset(
  pack: string,
  file: string,
  store: EmojiStore,
  head = false
): Response {
  const match = SVG_FILE_RE.exec(file);
  if (!match || !store.has(pack)) {
    return notFound(head);
  }
  const root = store.assetRoot(pack);
  if (!root) {
    return notFound(head);
  }

  const full = resolve(root, file);
  if (full !== root && !full.startsWith(root + sep)) {
    return notFound(head);
  }

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = realpathSync(root);
    realFull = realpathSync(full);
  } catch {
    return notFound(head);
  }
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) {
    return notFound(head);
  }

  let isFile = false;
  try {
    const stat = lstatSync(full);
    isFile = stat.isFile() && !stat.isSymbolicLink() && statSync(realFull).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return notFound(head);
  }

  let data: Buffer;
  try {
    data = readFileSync(realFull);
  } catch {
    return notFound(head);
  }
  return new Response(head ? null : data, {
    headers: baseHeaders("image/svg+xml"),
  });
}
