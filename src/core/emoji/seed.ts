import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLED_EMOJI_RAW, EMOJI_SCHEMA_JSON } from "./builtin";
import { EMOJI_SCHEMA_FILE } from "./constants";
import type { EmojiError } from "./types";

export interface SeedEmojiOptions {
  dir: string;
  bundled?: ReadonlyMap<string, unknown>;
  schema?: unknown;
  logger?: { warn(message: string): void };
}

export interface SeedEmojiResult {
  created: string[];
  skipped: string[];
  errors: EmojiError[];
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

/** Seeds the builtin pack and its JSON Schema without overwriting anything. */
export function seedEmojiPacks(options: SeedEmojiOptions): SeedEmojiResult {
  const bundled = options.bundled ?? BUNDLED_EMOJI_RAW;
  const schema = options.schema ?? EMOJI_SCHEMA_JSON;
  const result: SeedEmojiResult = { created: [], skipped: [], errors: [] };

  try {
    mkdirSync(options.dir, { recursive: true });
  } catch (err) {
    result.errors.push({
      file: options.dir,
      message: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  for (const name of [...bundled.keys()].sort((a, b) => a.localeCompare(b))) {
    const path = join(options.dir, `${name}.json`);
    if (exists(path)) {
      result.skipped.push(name);
      continue;
    }
    try {
      writeAtomic(path, JSON.stringify(bundled.get(name), null, 2) + "\n");
      result.created.push(name);
    } catch (err) {
      result.errors.push({ file: path, message: err instanceof Error ? err.message : String(err) });
    }
  }

  const schemaPath = join(options.dir, EMOJI_SCHEMA_FILE);
  if (exists(schemaPath)) {
    result.skipped.push(EMOJI_SCHEMA_FILE);
  } else {
    try {
      writeAtomic(schemaPath, JSON.stringify(schema, null, 2) + "\n");
      result.created.push(EMOJI_SCHEMA_FILE);
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
