import { DEFAULT_ICON_PACK, isIconSlug, isReservedIconPack } from "./constants";
import { hasIconPack } from "./index";
import type { IconStore } from "./store";

/**
 * Selection precedence: `?icons=` > `mdprv_icons` cookie > `config.icons` >
 * builtin `breeze`. Unknown or unloaded slugs fall through to the next step,
 * so a deleted pack never breaks a page. A reserved name (including the legacy
 * `default`) always resolves to the builtin pack instead of a user file.
 */
export function resolveIconPackName(
  query: string | null,
  cookie: string | null,
  fallback: string,
  store?: IconStore
): string {
  const lookup = (name: string | null): string | null => {
    if (!isIconSlug(name)) {
      return null;
    }
    if (isReservedIconPack(name)) {
      return DEFAULT_ICON_PACK;
    }
    const available = store ? store.has(name) : hasIconPack(name);
    return available ? name : null;
  };
  return lookup(query) ?? lookup(cookie) ?? lookup(fallback) ?? DEFAULT_ICON_PACK;
}
