import type { EmojiPackEntry } from "../contract";
import { DEFAULT_EMOJI_PACK } from "./constants";
import { createEmojiStore, type EmojiStore } from "./store";

let active: EmojiStore | null = null;

export function getEmojiStore(): EmojiStore {
  if (!active) {
    active = createEmojiStore({ dir: null, watch: false });
  }
  return active;
}

export function setEmojiStore(store: EmojiStore | null): void {
  active = store;
}

export function emojiPackNames(): string[] {
  return getEmojiStore().names();
}

export function hasEmojiPack(name: string | null | undefined): boolean {
  return getEmojiStore().has(name);
}

/** Builtin `github` is always available; unknown names fall back to it. */
export function isKnownEmojiPack(name: string | null | undefined): boolean {
  return getEmojiStore().has(name);
}

export function emojiPackEntries(): EmojiPackEntry[] {
  return getEmojiStore()
    .list()
    .map((entry) => {
      const out: EmojiPackEntry = {
        name: entry.name,
        label: entry.label,
        style: entry.style,
        source: entry.source,
        count: entry.count,
      };
      if (entry.description !== undefined) out.description = entry.description;
      if (entry.license !== undefined) out.license = entry.license;
      if (entry.attribution !== undefined) out.attribution = entry.attribution;
      return out;
    });
}

/** Used by the renderer to decide between `<img>` and the Unicode fallback. */
export function emojiAssetExists(pack: string, shortcode: string): boolean {
  return getEmojiStore().hasAsset(pack, shortcode);
}

export function emojiErrors() {
  return getEmojiStore().errors();
}

export { DEFAULT_EMOJI_PACK };
export type { EmojiStore };
