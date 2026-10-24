import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { BUNDLED_THEMES } from "./builtin";
import {
  DEFAULT_THEME,
  MAX_THEME_FILE_BYTES,
  THEME_NAME_RE,
  THEME_SCHEMA_FILE,
} from "./constants";
import type {
  FixedTheme,
  ResolvedTheme,
  Theme,
  ThemeError,
  ThemeInfo,
} from "./types";
import { validateTheme } from "./validate";

export interface ThemeChange {
  names: string[];
  changed: string[];
  version: number;
}

export interface ThemeLogger {
  warn(message: string): void;
}

export interface ThemeStoreOptions {
  dir?: string | null;
  bundled?: ReadonlyMap<string, Theme>;
  logger?: ThemeLogger;
  watch?: boolean;
  onChange?: (change: ThemeChange) => void;
  now?: () => number;
}

export interface ThemeStore {
  readonly dir: string | null;
  names(): string[];
  has(name: string | null | undefined): boolean;
  get(name?: string | null): ResolvedTheme;
  list(): ThemeInfo[];
  errors(): ThemeError[];
  refresh(force?: boolean): ThemeChange | null;
  close(): void;
}

interface ScanResult {
  themes: Map<string, Theme>;
  signatures: Map<string, string>;
  errors: ThemeError[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ordered(merged: Map<string, Theme>): string[] {
  return [...merged.keys()].sort((a, b) => {
    if (a === DEFAULT_THEME) return -1;
    if (b === DEFAULT_THEME) return 1;
    return a.localeCompare(b);
  });
}

function resolveMerged(merged: Map<string, Theme>): {
  resolved: Map<string, ResolvedTheme>;
  invalidAuto: string[];
} {
  const resolved = new Map<string, ResolvedTheme>();
  const invalidAuto: string[] = [];
  for (const [name, theme] of merged) {
    if (theme.kind === "light" || theme.kind === "dark") {
      resolved.set(name, { name, kind: theme.kind, light: theme, dark: theme });
    }
  }
  for (const [name, theme] of merged) {
    if (theme.kind !== "auto") {
      continue;
    }
    const light = merged.get(theme.variants.light);
    const dark = merged.get(theme.variants.dark);
    if (light && light.kind !== "auto" && dark && dark.kind !== "auto") {
      resolved.set(name, { name, kind: "auto", light, dark });
    } else {
      invalidAuto.push(name);
    }
  }
  return { resolved, invalidAuto };
}

export function createThemeStore(options: ThemeStoreOptions = {}): ThemeStore {
  const dir = options.dir ?? null;
  const bundled = options.bundled ?? BUNDLED_THEMES;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  let userThemes = new Map<string, Theme>();
  let userSignatures = new Map<string, string>();
  let errors: ThemeError[] = [];
  let resolved = new Map<string, ResolvedTheme>();
  let orderedNames: string[] = [];
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
    const merged = new Map<string, Theme>(bundled);
    for (const [name, theme] of userThemes) {
      merged.set(name, theme);
    }

    let outcome = resolveMerged(merged);
    for (const name of outcome.invalidAuto) {
      if (userThemes.has(name)) {
        merged.delete(name);
        const error = { file: name, message: `unknown variants for auto theme` };
        errors.push(error);
        warn(`invalid theme ${name}: unknown auto variants`);
      }
    }
    if (outcome.invalidAuto.some((name) => !userThemes.has(name))) {
      outcome = resolveMerged(merged);
    }

    resolved = outcome.resolved;
    if (!resolved.has(DEFAULT_THEME)) {
      const firstFixed = [...merged.values()].find(
        (theme) => theme.kind === "light" || theme.kind === "dark"
      );
      if (firstFixed) {
        const fixed = firstFixed as FixedTheme;
        resolved.set(fixed.name, {
          name: fixed.name,
          kind: fixed.kind,
          light: fixed,
          dark: fixed,
        });
      }
    }
    orderedNames = ordered(merged).filter((name) => resolved.has(name));
    if (orderedNames.length === 0) {
      const fallback = [...resolved.keys()].sort()[0];
      if (fallback) {
        orderedNames = [fallback];
      }
    }
  }

  function scan(): ScanResult {
    const themes = new Map<string, Theme>();
    const signatures = new Map<string, string>();
    const found: ThemeError[] = [];
    if (!dir) {
      return { themes, signatures, errors: found };
    }

    let entries: Array<{ name: string; isSymbolicLink(): boolean; isFile(): boolean }>;
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
    } catch {
      return { themes, signatures, errors: found };
    }

    for (const entry of entries) {
      const file = String(entry.name);
      if (!file.endsWith(".json") || file === THEME_SCHEMA_FILE) {
        continue;
      }
      const name = file.slice(0, -".json".length);
      if (!THEME_NAME_RE.test(name)) {
        continue;
      }
      const path = join(dir, file);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!warnedSymlinks.has(path)) {
            warnedSymlinks.add(path);
            warn(`ignoring theme symlink ${path}`);
          }
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_THEME_FILE_BYTES) {
          found.push({ file: path, message: "theme file is larger than 256 KiB" });
          continue;
        }
        const signature = `${stat.mtimeMs}:${stat.size}`;
        const previous = userSignatures.get(name);
        if (previous === signature && userThemes.has(name)) {
          themes.set(name, userThemes.get(name)!);
          signatures.set(name, signature);
          continue;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(path, "utf8"));
        } catch (err) {
          found.push({ file: path, message: err instanceof Error ? err.message : String(err) });
          continue;
        }
        try {
          const theme = validateTheme(name, raw);
          themes.set(name, theme);
          signatures.set(name, signature);
        } catch (err) {
          found.push({ file: path, message: err instanceof Error ? err.message : String(err) });
        }
      } catch (err) {
        found.push({ file: path, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { themes, signatures, errors: found };
  }

  function refresh(force = false): ThemeChange | null {
    const stamp = now();
    if (!force && stamp - lastScan < 250) {
      return null;
    }
    lastScan = stamp;
    const result = scan();
    const changed = new Set<string>();
    for (const name of result.themes.keys()) {
      if (userSignatures.get(name) !== result.signatures.get(name)) {
        changed.add(name);
      }
    }
    for (const name of userSignatures.keys()) {
      if (!result.signatures.has(name)) {
        changed.add(name);
      }
    }
    userThemes = result.themes;
    userSignatures = result.signatures;
    errors = result.errors;
    for (const error of errors) {
      warn(`invalid theme ${error.file}: ${error.message}`);
    }
    rebuild();
    const names = namesSnapshot();
    if (!initialized) {
      initialized = true;
      return null;
    }
    if (changed.size === 0) {
      return null;
    }
    version += 1;
    const change: ThemeChange = { names, changed: [...changed].sort(), version };
    options.onChange?.(change);
    return change;
  }

  function namesSnapshot(): string[] {
    return [...orderedNames];
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
        warn(`theme refresh failed: ${err instanceof Error ? err.message : String(err)}`);
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

  const store: ThemeStore = {
    dir,
    names: namesSnapshot,
    has(name) {
      return !!name && resolved.has(name);
    },
    get(name) {
      if (name) {
        const theme = resolved.get(name);
        if (theme) {
          return theme;
        }
      }
      const fallback = resolved.get(DEFAULT_THEME) ?? resolved.get(orderedNames[0]);
      if (!fallback) {
        throw new Error("no themes available");
      }
      return fallback;
    },
    list() {
      return namesSnapshot().map((name) => ({
        name,
        source: userThemes.has(name) ? "user" : "builtin",
      }));
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
