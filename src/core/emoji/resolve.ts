import { DEFAULT_EMOJI_PACK, isEmojiSlug } from "./constants";
import { hasEmojiPack } from "./index";
import type { EmojiStore } from "./store";

/**
 * Selection precedence: `?emoji=` > `mdprv_emoji` cookie > `config.emoji` >
 * builtin `github`. Unknown or unloaded slugs fall through to the next step,
 * so a deleted pack never breaks a page.
 */
export function resolveEmojiPackName(
  query: string | null,
  cookie: string | null,
  fallback: string,
  store?: EmojiStore
): string {
  const has = (name: string | null): boolean => {
    if (!isEmojiSlug(name)) {
      return false;
    }
    return store ? store.has(name) : hasEmojiPack(name);
  };
  if (has(query)) {
    return query!;
  }
  if (has(cookie)) {
    return cookie!;
  }
  if (has(fallback)) {
    return fallback;
  }
  return DEFAULT_EMOJI_PACK;
}
