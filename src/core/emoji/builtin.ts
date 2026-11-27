import emojiSchema from "../../../emojis/emoji.schema.json";
import githubRaw from "../../../emojis/github.json";

import { DEFAULT_EMOJI_PACK } from "./constants";
import type { EmojiPack } from "./types";
import { validateEmojiPack } from "./validate";

export const EMOJI_SCHEMA_JSON: unknown = emojiSchema;

export const BUNDLED_EMOJI_RAW: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["github", githubRaw],
]);

export const BUNDLED_EMOJI_PACKS: ReadonlyMap<string, EmojiPack> = new Map<string, EmojiPack>(
  [...BUNDLED_EMOJI_RAW].map(([name, raw]): [string, EmojiPack] => [
    name,
    validateEmojiPack(name, raw),
  ])
);

/** Builtin first, then alphabetical, mirroring theme ordering. */
export const BUILTIN_EMOJI_NAMES: readonly string[] = [...BUNDLED_EMOJI_PACKS.keys()].sort(
  (a, b) => {
    if (a === DEFAULT_EMOJI_PACK) return -1;
    if (b === DEFAULT_EMOJI_PACK) return 1;
    return a.localeCompare(b);
  }
);
