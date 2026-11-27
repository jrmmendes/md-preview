import iconSchema from "../../../icons/icon.schema.json";
import breezeRaw from "../../../icons/breeze.json";

import { DEFAULT_ICON_PACK } from "./constants";
import { BUNDLED_ICON_SVGS } from "./builtin-assets";
import type { IconPack } from "./types";
import { validateIconPack } from "./validate";

export { BUNDLED_ICON_SVGS };

export const ICON_SCHEMA_JSON: unknown = iconSchema;

export const BUNDLED_ICON_RAW: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["breeze", breezeRaw],
]);

export const BUNDLED_ICON_PACKS: ReadonlyMap<string, IconPack> = new Map<string, IconPack>(
  [...BUNDLED_ICON_RAW].map(([name, raw]): [string, IconPack] => [
    name,
    validateIconPack(name, raw),
  ])
);

/** Builtin first, then alphabetical, mirroring theme ordering. */
export const BUILTIN_ICON_NAMES: readonly string[] = [...BUNDLED_ICON_PACKS.keys()].sort(
  (a, b) => {
    if (a === DEFAULT_ICON_PACK) return -1;
    if (b === DEFAULT_ICON_PACK) return 1;
    return a.localeCompare(b);
  }
);

/** Embedded SVG for a builtin pack key, or `null` when not bundled. */
export function builtinIconSvg(pack: string, key: string): string | null {
  return BUNDLED_ICON_SVGS.get(`${pack}:${key}`) ?? null;
}
