/**
 * Filesystem store for emoji packs (`<configDir>/emojis/<slug>.json`).
 *
 * Same safety model as the theme stores: direct children only, no symlinks,
 * per-file byte cap and a bounded number of user packs. Builtin packs are
 * merged underneath, so a manually created `github.json` overrides the
 * bundled one while imports reject builtin slugs up front.
 */
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { BUNDLED_EMOJI_PACKS } from "./builtin";
import {
  DEFAULT_EMOJI_PACK,
  EMOJI_ASSETS_DIR_NAME,
  EMOJI_SCHEMA_FILE,
  EMOJI_SHORTCODE_RE,
  MAX_EMOJI_FILE_BYTES,
  MAX_EMOJI_PACKS,
  emojiFileName,
  isEmojiSlug,
} from "./constants";
import { emojiLabel } from "./defaults";
import type { EmojiError, EmojiPack, EmojiPackInfo } from "./types";
import { validateEmojiPack } from "./validate";

export interface EmojiChange {
  names: string[];
  changed: string[];
  version: number;
}

export interface EmojiLogger {
  warn(message: string): void;
}

export interface EmojiStoreOptions {
  dir?: string | null;
  bundled?: ReadonlyMap<string, EmojiPack>;
  logger?: EmojiLogger;
  watch?: boolean;
  onChange?: (change: EmojiChange) => void;
  now?: () => number;
}

export interface EmojiStore {
  readonly dir: string | null;
  names(): string[];
  has(name: string | null | undefined): boolean;
  get(name?: string | null): EmojiPack;
  list(): EmojiPackInfo[];
  errors(): EmojiError[];
  /** Directory holding SVG assets for one pack, or `null` when unsafe/absent. */
  assetRoot(name: string): string | null;
  /** Whether `<dir>/assets/<pack>/<shortcode>.svg` is a regular file. */
  hasAsset(pack: string, shortcode: string): boolean;
  refresh(force?: boolean): EmojiChange | null;
  close(): void;
}

interface ScanResult {
  packs: Map<string, EmojiPack>;
  signatures: Map<string, string>;
  errors: EmojiError[];
}

function ordered(merged: Map<string, EmojiPack>): string[] {
  return [...merged.keys()].sort((a, b) => {
    if (a === DEFAULT_EMOJI_PACK) return -1;
    if (b === DEFAULT_EMOJI_PACK) return 1;
    return a.localeCompare(b);
  });
}

export function createEmojiStore(options: EmojiStoreOptions = {}): EmojiStore {
  const dir = options.dir ?? null;
  const bundled = options.bundled ?? BUNDLED_EMOJI_PACKS;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  let userPacks = new Map<string, EmojiPack>();
  let userSignatures = new Map<string, string>();
  let errors: EmojiError[] = [];
  let merged = new Map<string, EmojiPack>(bundled);
  let orderedNames: string[] = ordered(merged);
  let version = 0;
  let lastScan = 0;
  let initialized = false;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const warnedSymlinks = new Set<string>();

  function warn(message: string): void {
    logger?.warn(`md-preview: ${message}`);
  }

  function rebuild(): void {
    merged = new Map<string, EmojiPack>(bundled);
    for (const [name, pack] of userPacks) {
      merged.set(name, pack);
    }
    orderedNames = ordered(merged);
  }

  function scan(): ScanResult {
    const packs = new Map<string, EmojiPack>();
    const signatures = new Map<string, string>();
    const found: EmojiError[] = [];
    if (!dir) {
      return { packs, signatures, errors: found };
    }

    let entries: Array<{ name: string }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return { packs, signatures, errors: found };
    }

    let count = 0;
    for (const entry of entries) {
      const file = String(entry.name);
      if (!file.endsWith(".json") || file === EMOJI_SCHEMA_FILE) {
        continue;
      }
      if (count >= MAX_EMOJI_PACKS) {
        found.push({
          file: dir,
          message: `too many emoji pack files (max ${MAX_EMOJI_PACKS})`,
        });
        break;
      }
      const name = file.slice(0, -".json".length);
      if (!isEmojiSlug(name)) {
        continue;
      }
      const path = join(dir, file);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!warnedSymlinks.has(path)) {
            warnedSymlinks.add(path);
            warn(`ignoring emoji pack symlink ${path}`);
          }
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_EMOJI_FILE_BYTES) {
          found.push({ file: path, message: "emoji pack file is larger than 256 KiB" });
          continue;
        }
        count += 1;
        const text = readFileSync(path, "utf8");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch (err) {
          found.push({ file: path, message: err instanceof Error ? err.message : String(err) });
          continue;
        }
        const pack = validateEmojiPack(name, raw);
        packs.set(name, pack);
        signatures.set(name, `${stat.mtimeMs}:${stat.size}:${pack.id}`);
      } catch (err) {
        found.push({ file: path, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { packs, signatures, errors: found };
  }

  function namesSnapshot(): string[] {
    return [...orderedNames];
  }

  function refresh(force = false): EmojiChange | null {
    const stamp = now();
    if (!force && stamp - lastScan < 250) {
      return null;
    }
    lastScan = stamp;
    const result = scan();
    const changed = new Set<string>();
    for (const name of result.packs.keys()) {
      if (userSignatures.get(name) !== result.signatures.get(name)) {
        changed.add(name);
      }
    }
    for (const name of userSignatures.keys()) {
      if (!result.signatures.has(name)) {
        changed.add(name);
      }
    }
    userPacks = result.packs;
    userSignatures = result.signatures;
    errors = result.errors;
    for (const error of errors) {
      warn(`invalid emoji pack ${error.file}: ${error.message}`);
    }
    rebuild();
    if (!initialized) {
      initialized = true;
      return null;
    }
    if (changed.size === 0) {
      return null;
    }
    version += 1;
    const change: EmojiChange = { names: namesSnapshot(), changed: [...changed].sort(), version };
    options.onChange?.(change);
    return change;
  }

  function schedule(): void {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => {
      debounce = null;
      try {
        refresh(true);
      } catch (err) {
        warn(`emoji refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 150);
  }

  function assetRoot(name: string): string | null {
    if (!dir || !isEmojiSlug(name)) {
      return null;
    }
    return join(dir, EMOJI_ASSETS_DIR_NAME, name);
  }

  function startWatch(): void {
    if (!dir || options.watch === false) {
      return;
    }
    try {
      watcher = watch(dir, { persistent: false }, () => schedule());
      watcher.on("error", () => {});
    } catch {
      watcher = null;
    }
  }

  const store: EmojiStore = {
    dir,
    names: namesSnapshot,
    has(name) {
      return !!name && merged.has(name);
    },
    get(name) {
      if (name) {
        const pack = merged.get(name);
        if (pack) {
          return pack;
        }
      }
      const fallback = merged.get(DEFAULT_EMOJI_PACK) ?? merged.get(orderedNames[0]);
      if (!fallback) {
        throw new Error("no emoji packs available");
      }
      return fallback;
    },
    list() {
      return namesSnapshot().map((name) => {
        const pack = merged.get(name)!;
        const info: EmojiPackInfo = {
          name,
          label: pack.label ?? emojiLabel(name),
          style: pack.style,
          source: userPacks.has(name) ? "user" : "builtin",
          count: Object.keys(pack.shortcodes).length,
        };
        if (pack.description !== undefined) info.description = pack.description;
        if (pack.license !== undefined) info.license = pack.license;
        if (pack.attribution !== undefined) info.attribution = pack.attribution;
        return info;
      });
    },
    errors() {
      return [...errors];
    },
    assetRoot,
    hasAsset(pack, shortcode) {
      const root = assetRoot(pack);
      if (!root || !EMOJI_SHORTCODE_RE.test(shortcode)) {
        return false;
      }
      try {
        const stat = lstatSync(join(root, `${shortcode}.svg`));
        return stat.isFile() && !stat.isSymbolicLink();
      } catch {
        return false;
      }
    },
    refresh,
    close() {
      if (debounce) {
        clearTimeout(debounce);
        debounce = null;
      }
      watcher?.close();
      watcher = null;
    },
  };

  refresh(true);
  startWatch();
  return store;
}

/** Shared helper used by the import endpoint to build the file path. */
export function emojiPackPath(dir: string, name: string): string {
  return join(dir, emojiFileName(name));
}
