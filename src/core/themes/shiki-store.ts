/**
 * Filesystem store for imported Shiki themes (`*.shiki.json`).
 *
 * Mirrors the UI theme store: only direct children of the themes directory,
 * no symlinks, a per-file byte cap and a bounded number of files. A content
 * hash is part of the signature so a file rewritten with the same size and
 * mtime still triggers a refresh.
 */
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { MAX_THEME_FILE_BYTES } from "./constants";
import {
  MAX_SHIKI_THEMES,
  SHIKI_FILE_SUFFIX,
  shikiLabel,
  validateShikiCustom,
  type ShikiCustomTheme,
} from "./shiki-custom";
import type { ThemeError } from "./types";

export interface ShikiThemeChange {
  names: string[];
  changed: string[];
  version: number;
}

export interface ShikiThemeInfo {
  name: string;
  label: string;
  kind: "light" | "dark";
  source: "custom";
}

export interface ShikiThemeLogger {
  warn(message: string): void;
}

export interface ShikiThemeStoreOptions {
  dir?: string | null;
  logger?: ShikiThemeLogger;
  watch?: boolean;
  onChange?: (change: ShikiThemeChange) => void;
  now?: () => number;
}

export interface ShikiThemeStore {
  readonly dir: string | null;
  names(): string[];
  has(name: string): boolean;
  get(name: string): ShikiCustomTheme | undefined;
  list(): ShikiThemeInfo[];
  errors(): ThemeError[];
  refresh(force?: boolean): ShikiThemeChange | null;
  close(): void;
}

interface ScanResult {
  themes: Map<string, ShikiCustomTheme>;
  signatures: Map<string, string>;
  errors: ThemeError[];
}

export function createShikiThemeStore(options: ShikiThemeStoreOptions = {}): ShikiThemeStore {
  const dir = options.dir ?? null;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  let themes = new Map<string, ShikiCustomTheme>();
  let signatures = new Map<string, string>();
  let errors: ThemeError[] = [];
  let names: string[] = [];
  let version = 0;
  let lastScan = 0;
  let initialized = false;
  let watcher: FSWatcher | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  const warnedSymlinks = new Set<string>();

  function warn(message: string): void {
    logger?.warn(`md-preview: ${message}`);
  }

  function scan(): ScanResult {
    const found = new Map<string, ShikiCustomTheme>();
    const foundSignatures = new Map<string, string>();
    const scanErrors: ThemeError[] = [];
    if (!dir) {
      return { themes: found, signatures: foundSignatures, errors: scanErrors };
    }

    let entries: Array<{ name: string }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return { themes: found, signatures: foundSignatures, errors: scanErrors };
    }

    let count = 0;
    for (const entry of entries) {
      const file = String(entry.name);
      if (!file.endsWith(SHIKI_FILE_SUFFIX)) {
        continue;
      }
      if (count >= MAX_SHIKI_THEMES) {
        scanErrors.push({
          file: dir,
          message: `too many custom Shiki theme files (max ${MAX_SHIKI_THEMES})`,
        });
        break;
      }
      const name = file.slice(0, -SHIKI_FILE_SUFFIX.length);
      const path = join(dir, file);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!warnedSymlinks.has(path)) {
            warnedSymlinks.add(path);
            warn(`ignoring Shiki theme symlink ${path}`);
          }
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_THEME_FILE_BYTES) {
          scanErrors.push({ file: path, message: "Shiki theme file is larger than 256 KiB" });
          continue;
        }
        count += 1;
        const text = readFileSync(path, "utf8");
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch (err) {
          scanErrors.push({ file: path, message: err instanceof Error ? err.message : String(err) });
          continue;
        }
        const theme = validateShikiCustom(raw, name);
        found.set(name, theme);
        foundSignatures.set(name, `${stat.mtimeMs}:${stat.size}:${theme.sha}`);
      } catch (err) {
        scanErrors.push({ file: path, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { themes: found, signatures: foundSignatures, errors: scanErrors };
  }

  function sortedNames(): string[] {
    return [...themes.keys()].sort((a, b) => a.localeCompare(b));
  }

  function refresh(force = false): ShikiThemeChange | null {
    const stamp = now();
    if (!force && stamp - lastScan < 250) {
      return null;
    }
    lastScan = stamp;
    const result = scan();
    const changed = new Set<string>();
    for (const name of result.themes.keys()) {
      if (signatures.get(name) !== result.signatures.get(name)) {
        changed.add(name);
      }
    }
    for (const name of signatures.keys()) {
      if (!result.signatures.has(name)) {
        changed.add(name);
      }
    }
    themes = result.themes;
    signatures = result.signatures;
    errors = result.errors;
    for (const error of errors) {
      warn(`invalid Shiki theme ${error.file}: ${error.message}`);
    }
    names = sortedNames();
    if (!initialized) {
      initialized = true;
      return null;
    }
    if (changed.size === 0) {
      return null;
    }
    version += 1;
    const change: ShikiThemeChange = { names: [...names], changed: [...changed].sort(), version };
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
        warn(`Shiki theme refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 150);
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

  const store: ShikiThemeStore = {
    dir,
    names() {
      return [...names];
    },
    has(name) {
      return themes.has(name);
    },
    get(name) {
      return themes.get(name);
    },
    list() {
      return sortedNames().map((name) => {
        const theme = themes.get(name)!;
        return {
          name,
          label: shikiLabel(name),
          kind: theme.kind,
          source: "custom" as const,
        };
      });
    },
    errors() {
      return [...errors];
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
