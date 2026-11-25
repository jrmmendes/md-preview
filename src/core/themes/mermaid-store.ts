/**
 * Filesystem store for imported Mermaid themes (`*.mermaid.json`).
 *
 * Same safety model as the Shiki store: direct children only, no symlinks,
 * per-file byte cap and a bounded number of files. The content hash is part of
 * the signature so a same-size rewrite still refreshes the catalog.
 */
import { lstatSync, readdirSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { MAX_THEME_FILE_BYTES } from "./constants";
import {
  MAX_MERMAID_THEMES,
  MERMAID_FILE_SUFFIX,
  mermaidLabel,
  validateMermaidCustom,
  type MermaidCustomTheme,
} from "./mermaid-custom";
import type { ThemeError } from "./types";

export interface MermaidThemeChange {
  names: string[];
  changed: string[];
  version: number;
}

export interface MermaidThemeInfo {
  name: string;
  label: string;
  source: "custom";
  theme: string;
  variables: Record<string, string>;
}

export interface MermaidThemeLogger {
  warn(message: string): void;
}

export interface MermaidThemeStoreOptions {
  dir?: string | null;
  logger?: MermaidThemeLogger;
  watch?: boolean;
  onChange?: (change: MermaidThemeChange) => void;
  now?: () => number;
}

export interface MermaidThemeStore {
  readonly dir: string | null;
  names(): string[];
  has(name: string): boolean;
  get(name: string): MermaidCustomTheme | undefined;
  list(): MermaidThemeInfo[];
  errors(): ThemeError[];
  refresh(force?: boolean): MermaidThemeChange | null;
  close(): void;
}

interface ScanResult {
  themes: Map<string, MermaidCustomTheme>;
  signatures: Map<string, string>;
  errors: ThemeError[];
}

export function createMermaidThemeStore(
  options: MermaidThemeStoreOptions = {}
): MermaidThemeStore {
  const dir = options.dir ?? null;
  const logger = options.logger;
  const now = options.now ?? Date.now;

  let themes = new Map<string, MermaidCustomTheme>();
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
    const found = new Map<string, MermaidCustomTheme>();
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
      if (!file.endsWith(MERMAID_FILE_SUFFIX)) {
        continue;
      }
      if (count >= MAX_MERMAID_THEMES) {
        scanErrors.push({
          file: dir,
          message: `too many custom Mermaid theme files (max ${MAX_MERMAID_THEMES})`,
        });
        break;
      }
      const name = file.slice(0, -MERMAID_FILE_SUFFIX.length);
      const path = join(dir, file);
      try {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) {
          if (!warnedSymlinks.has(path)) {
            warnedSymlinks.add(path);
            warn(`ignoring Mermaid theme symlink ${path}`);
          }
          continue;
        }
        if (!stat.isFile()) {
          continue;
        }
        if (stat.size > MAX_THEME_FILE_BYTES) {
          scanErrors.push({ file: path, message: "Mermaid theme file is larger than 256 KiB" });
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
        const theme = validateMermaidCustom(raw, name);
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

  function refresh(force = false): MermaidThemeChange | null {
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
      warn(`invalid Mermaid theme ${error.file}: ${error.message}`);
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
    const change: MermaidThemeChange = { names: [...names], changed: [...changed].sort(), version };
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
        warn(`Mermaid theme refresh failed: ${err instanceof Error ? err.message : String(err)}`);
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

  const store: MermaidThemeStore = {
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
          label: mermaidLabel(name),
          source: "custom" as const,
          theme: theme.theme,
          variables: { ...theme.variables },
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
