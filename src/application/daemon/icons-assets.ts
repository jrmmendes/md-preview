/**
 * `GET /__icon-assets/<pack>/<key>.svg`: serves the SVG for one icon key.
 *
 * Resolution order mirrors the client contract:
 *   1. the selected pack (data URI or relative path under the icons dir);
 *   2. the builtin `breeze` asset embedded in the binary;
 *   3. a generic fallback glyph from `defaults.ts`.
 *
 * Path traversal, symlinks and non-regular files are rejected with 404 for
 * user assets. A key that is missing everywhere still returns a valid SVG so a
 * `mask-image` never falls back to painting a solid box.
 */
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import {
  DEFAULT_ICON_PACK,
  isIconKey,
  isIconSlug,
} from "../../core/icons/constants";
import { FALLBACK_ICON_SVG } from "../../core/icons/defaults";
import { builtinIconSvg } from "../../core/icons/builtin";
import type { IconStore } from "../../core/icons/store";
import { baseHeaders } from "./headers";

const SVG_FILE_RE = /^([a-z0-9][a-z0-9-]*)\.svg$/;
const SVG_DATA_URI = /^data:image\/svg\+xml;base64,([A-Za-z0-9+/]+={0,2})$/i;

function notFound(head = false): Response {
  return new Response(head ? null : "not found", {
    status: 404,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

function svgResponse(svg: string | Buffer, head = false): Response {
  return new Response(head ? null : svg, {
    headers: baseHeaders("image/svg+xml"),
  });
}

function decodeDataUri(value: string): Buffer | null {
  const match = SVG_DATA_URI.exec(value);
  if (!match) {
    return null;
  }
  try {
    const data = Buffer.from(match[1]!, "base64");
    return data.byteLength > 0 ? data : null;
  } catch {
    return null;
  }
}

function readUserAsset(root: string, full: string): Buffer | null {
  const target = resolve(full);
  if (target !== root && !target.startsWith(root + sep)) {
    return null;
  }
  let realRoot: string;
  let realFull: string;
  try {
    realRoot = realpathSync(root);
    realFull = realpathSync(target);
  } catch {
    return null;
  }
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) {
    return null;
  }
  try {
    const stat = lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return null;
    }
    if (!statSync(realFull).isFile()) {
      return null;
    }
    return readFileSync(realFull);
  } catch {
    return null;
  }
}

export type BuiltinIconLookup = (pack: string, key: string) => string | null;

/**
 * Per-key fallback chain: builtin default pack -> the selected pack (same
 * thing when the default is selected) -> generic glyph. Kept pure so tests can
 * exercise the last step without mutating the embedded map.
 */
export function fallbackIconSvg(
  pack: string,
  key: string,
  lookup: BuiltinIconLookup = builtinIconSvg
): string {
  return lookup(DEFAULT_ICON_PACK, key) ?? lookup(pack, key) ?? FALLBACK_ICON_SVG;
}

export function serveIconAsset(
  pack: string,
  file: string,
  store: IconStore,
  head = false
): Response {
  const match = SVG_FILE_RE.exec(file);
  if (!match || !isIconSlug(pack)) {
    return notFound(head);
  }
  const key = match[1]!;
  if (!isIconKey(key) || !store.has(pack)) {
    return notFound(head);
  }

  // The reserved builtin pack is immutable: always serve the embedded SVG so
  // stray files under `<configDir>/icons/breeze/` can never shadow it.
  if (pack === DEFAULT_ICON_PACK) {
    return svgResponse(fallbackIconSvg(pack, key), head);
  }

  const value = store.iconValue(pack, key);
  if (value) {
    if (value.startsWith("data:image/")) {
      const data = decodeDataUri(value);
      if (data) {
        return svgResponse(data, head);
      }
    } else {
      const root = store.assetRoot(pack);
      const full = store.iconPath(pack, key);
      if (root && full) {
        const data = readUserAsset(root, full);
        if (data) {
          return svgResponse(data, head);
        }
      }
    }
  }

  return svgResponse(fallbackIconSvg(pack, key), head);
}
