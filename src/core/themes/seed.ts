import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLED_RAW, THEME_SCHEMA_JSON } from "./builtin";
import { THEME_SCHEMA_FILE } from "./constants";
import type { ThemeError } from "./types";

export interface SeedThemesOptions {
  dir: string;
  bundled?: ReadonlyMap<string, unknown>;
  schema?: unknown;
  logger?: { warn(message: string): void };
}

export interface SeedThemesResult {
  created: string[];
  skipped: string[];
  errors: ThemeError[];
}

function writeAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, { mode: 0o644 });
  renameSync(tmp, path);
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

export function seedThemes(options: SeedThemesOptions): SeedThemesResult {
  const bundled = options.bundled ?? BUNDLED_RAW;
  const schema = options.schema ?? THEME_SCHEMA_JSON;
  const result: SeedThemesResult = { created: [], skipped: [], errors: [] };

  try {
    mkdirSync(options.dir, { recursive: true });
  } catch (err) {
    result.errors.push({
      file: options.dir,
      message: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const names = [...bundled.keys()].sort((a, b) => {
    if (a === "auto") return -1;
    if (b === "auto") return 1;
    return a.localeCompare(b);
  });

  for (const name of names) {
    const path = join(options.dir, `${name}.json`);
    if (exists(path)) {
      result.skipped.push(name);
      continue;
    }
    try {
      writeAtomic(path, JSON.stringify(bundled.get(name), null, 2) + "\n");
      result.created.push(name);
    } catch (err) {
      result.errors.push({
        file: path,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const schemaPath = join(options.dir, THEME_SCHEMA_FILE);
  if (exists(schemaPath)) {
    result.skipped.push(THEME_SCHEMA_FILE);
  } else {
    try {
      writeAtomic(schemaPath, JSON.stringify(schema, null, 2) + "\n");
      result.created.push(THEME_SCHEMA_FILE);
    } catch (err) {
      result.errors.push({
        file: schemaPath,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (const error of result.errors) {
    options.logger?.warn(`md-preview: could not seed ${error.file}: ${error.message}`);
  }
  return result;
}
