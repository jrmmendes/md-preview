/**
 * Filesystem store for icon packs (`<configDir>/icons/<slug>.json`).
 *
 * Same safety model as the theme/emoji stores: direct children only, no
 * symlinks, per-file byte cap and a bounded number of user packs. The builtin
 * default pack is immutable: a user file named after a reserved slug (`breeze`
 * or the legacy `default`) is ignored and reported in `errors()`, so it can
 * never shadow the bundled manifest or affect selection.
 */
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join, resolve, sep } from "node:path";

import { BUNDLED_ICON_PACKS } from "./builtin";
import {
  DEFAULT_ICON_PACK,
  ICON_SCHEMA_FILE,
  LEGACY_ICON_PACK,
  MAX_ICON_FILE_BYTES,
  MAX_ICON_PACKS,
  iconFileName,
  isIconKey,
  isIconSlug,
  isReservedIconPack,
} from "./constants";
import { iconLabel } from "./defaults";
import type { IconError, IconPack, IconPackInfo } from "./types";
import { validateIconPack } from "./validate";

export interface IconChange {
  names: string[];
  changed: string[];
  version: number;
}

export interface IconLogger {
  warn(message: string): void;
}

export interface IconStoreOptions {
  dir?: string | null;
  bundled?: ReadonlyMap<string, IconPack>;
  logger?: IconLogger;
  watch?: boolean;
  onChange?: (change: IconChange) => void;
  now?: () => number;
}

export interface IconStore {
  readonly dir: string | null;
  names(): string[];
  has(name: string | null | undefined): boolean;
  get(name?: string | null): IconPack;
  list(): IconPackInfo[];
  errors(): IconError[];
  /** Root used to resolve relative asset paths, or `null` when unavailable. */
  assetRoot(name: string): string | null;
  /** Raw manifest value (relative path or data URI) for one key. */
  iconValue(pack: string, key: string): string | null;
  /** Absolute path for a path-based icon, or `null` when unsafe/absent. */
  iconPath(pack: string, key: string): string | null;
  /** Whether the key resolves to a regular non-symlink file or a data URI. */
  hasIcon(pack: string, key: string): boolean;
  refresh(force?: boolean): IconChange | null;
  close(): void;
}

interface ScanResult {
  packs: Map<string, IconPack>;
  signatures: Map<string, string>;
  errors: IconError[];
}

function ordered(merged: Map<string, IconPack>): string[] {
  return [...merged.keys()].sort((a, b) => {
    if (a === DEFAULT_ICON_PACK) return -1;
    if (b === DEFAULT_ICON_PACK) return 1;
    return a.localeCompare(b);
  });
}

function isDataUri(value: string): boolean {
  return value.startsWith("data:image/");
}

export function createIconStore(options: IconStoreOptions = {}): IconStore {
  const dir = options.dir ?? null;
  const bundled = options.bundled ?? BUNDLED_ICON_PACKS;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  let userPacks = new Map<string, IconPack>();
  let userSignatures = new Map<string, string>();
  let errors: IconError[] = [];
  let merged = new Map<string, IconPack>(bundled);
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
    merged = new Map<string, IconPack>(bundled);
    for (const [name, pack] of userPacks) {
      // Defense in depth: scan already skips reserved names, but the builtin
      // default must win even if one ever reaches this map.
      if (isReservedIconPack(name)) {
        continue;
      }
      // Every bundled pack (`breeze`, `lucide`) is immutable: a user file with
      // the same slug never shadows the embedded manifest.
      if (bundled.has(name)) {
        continue;
      }
      merged.set(name, pack);
    }
    orderedNames = ordered(merged);
  }

  /**
   * A reserved-name file is only harmless when it is byte-for-byte the seeded
   * builtin manifest (same normalized id). `icons seed` writes that copy, so it
   * must not produce a permanent warning; any real override is still reported.
   */
  function matchesBuiltin(path: string, name: string): boolean {
    const expected = bundled.get(name);
    if (!expected) {
      return false;
    }
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_ICON_FILE_BYTES) {
        return false;
      }
      const raw = JSON.parse(readFileSync(path, "utf8"));
      return validateIconPack(name, raw).id === expected.id;
    } catch {
      return false;
    }
  }

  function scan(): ScanResult {
    const packs = new Map<string, IconPack>();
    const signatures = new Map<string, string>();
    const found: IconError[] = [];
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
      if (!file.endsWith(".json") || file === ICON_SCHEMA_FILE) {
        continue;
      }
      if (count >= MAX_ICON_PACKS) {
        found.push({
          file: dir,
          message: `too many icon pack files (max ${MAX_ICON_PACKS})`,
        });
        break;
      }
      const name = file.slice(0, -".json".length);
      if (!isIconSlug(name)) {
        continue;
      }
      const path = join(dir, file);
      if (name === LEGACY_ICON_PACK) {
        found.push({ file: path, message: "unsupported legacy icon pack" });
        continue;
      }
      if (isReservedIconPack(name)) {
        if (!matchesBuiltin(path, name)) {
          found.push({ file: path, message: `reserved icon pack name: ${name}` });
        }
        continue;
      }
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!warnedSymlinks.has(path)) {
            warnedSymlinks.add(path);
            warn(`ignoring icon pack symlink ${path}`);
          }
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_ICON_FILE_BYTES) {
          found.push({ file: path, message: "icon pack file is larger than 256 KiB" });
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
        const pack = validateIconPack(name, raw);
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

  function refresh(force = false): IconChange | null {
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
      warn(`invalid icon pack ${error.file}: ${error.message}`);
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
    const change: IconChange = { names: namesSnapshot(), changed: [...changed].sort(), version };
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
        warn(`icon refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 150);
  }

  function assetRoot(name: string): string | null {
    if (!dir || !isIconSlug(name) || !merged.has(name)) {
      return null;
    }
    return dir;
  }

  function iconValue(pack: string, key: string): string | null {
    if (!isIconKey(key)) {
      return null;
    }
    const entry = merged.get(pack);
    return entry?.icons[key] ?? null;
  }

  function iconPath(pack: string, key: string): string | null {
    const root = assetRoot(pack);
    const value = iconValue(pack, key);
    if (!root || !value || isDataUri(value)) {
      return null;
    }
    const full = resolve(root, value);
    if (full !== root && !full.startsWith(root + sep)) {
      return null;
    }
    return full;
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

  const store: IconStore = {
    dir,
    names: namesSnapshot,
    has(name) {
      return !!name && merged.has(name);
    },
    get(name) {
      if (name && !isReservedIconPack(name)) {
        const pack = merged.get(name);
        if (pack) {
          return pack;
        }
      }
      const fallback = merged.get(DEFAULT_ICON_PACK) ?? merged.get(orderedNames[0]);
      if (!fallback) {
        throw new Error("no icon packs available");
      }
      return fallback;
    },
    list() {
      return namesSnapshot().map((name) => {
        const pack = merged.get(name)!;
        const info: IconPackInfo = {
          name,
          label: pack.label ?? iconLabel(name),
          style: pack.style,
          source: bundled.has(name) ? "builtin" : "user",
          count: Object.keys(pack.icons).length,
        };
        if (name === DEFAULT_ICON_PACK) info.default = true;
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
    iconValue,
    iconPath,
    hasIcon(pack, key) {
      const value = iconValue(pack, key);
      if (!value) {
        return false;
      }
      if (isDataUri(value)) {
        return true;
      }
      const full = iconPath(pack, key);
      if (!full) {
        return false;
      }
      try {
        const stat = lstatSync(full);
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
export function iconPackPath(dir: string, name: string): string {
  return join(dir, iconFileName(name));
}
