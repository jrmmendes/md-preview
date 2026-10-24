import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import configSchema from "./config.schema.json";
import {
  CONFIG_FILE_NAME,
  CONFIG_SCHEMA_FILE,
  THEMES_DIR_NAME,
} from "./themes/constants";

export interface FileConfig {
  theme?: unknown;
  port?: unknown;
  idle?: unknown;
  loader?: unknown;
  zoomSensitivity?: unknown;
  seedThemes?: unknown;
}

export interface ReadConfigResult {
  config: FileConfig;
  errors: string[];
  warnings: string[];
  missing: boolean;
}

export interface ReadConfigOptions {
  readFile?: (path: string) => string | null;
}

const KNOWN_KEYS = new Set([
  "$schema",
  "theme",
  "port",
  "idle",
  "loader",
  "zoomSensitivity",
  "seedThemes",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveConfigDir(env: Record<string, string | undefined> = process.env): string {
  if (env.MDPRV_CONFIG_DIR) {
    return resolve(env.MDPRV_CONFIG_DIR);
  }
  const base = env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return resolve(base, "md-preview");
}

export function themesDir(configDir: string): string {
  return join(configDir, THEMES_DIR_NAME);
}

export function configFilePath(configDir: string): string {
  return join(configDir, CONFIG_FILE_NAME);
}

export function readConfigFile(configDir: string, options: ReadConfigOptions = {}): ReadConfigResult {
  const path = configFilePath(configDir);
  const result: ReadConfigResult = { config: {}, errors: [], warnings: [], missing: false };

  let text: string | null;
  if (options.readFile) {
    text = options.readFile(path);
  } else {
    try {
      text = readFileSync(path, "utf8");
    } catch {
      text = null;
    }
  }
  if (text === null) {
    result.missing = true;
    return result;
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    result.errors.push(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }
  if (!isRecord(raw)) {
    result.errors.push(`invalid config in ${path}: expected an object`);
    return result;
  }

  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) {
      result.warnings.push(`unknown config key ${JSON.stringify(key)} in ${path}`);
    }
  }

  result.config = {
    theme: raw.theme,
    port: raw.port,
    idle: raw.idle,
    loader: raw.loader,
    zoomSensitivity: raw.zoomSensitivity,
    seedThemes: raw.seedThemes,
  };
  return result;
}

export function defaultConfig(): Record<string, unknown> {
  return {
    $schema: "./config.schema.json",
    theme: "auto",
    port: 8766,
    idle: 15,
    loader: "classic",
    zoomSensitivity: 1.1,
    seedThemes: true,
  };
}

export const CONFIG_SCHEMA_JSON: unknown = configSchema;

export interface WriteConfigResult {
  created: boolean;
  path: string;
}

export function writeDefaultConfig(configDir: string): WriteConfigResult {
  const path = configFilePath(configDir);
  if (existsSync(path)) {
    return { created: false, path };
  }
  mkdirSync(configDir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(defaultConfig(), null, 2) + "\n", { mode: 0o644 });
  renameSync(tmp, path);

  const schemaPath = join(configDir, CONFIG_SCHEMA_FILE);
  if (!existsSync(schemaPath)) {
    const schemaTmp = `${schemaPath}.tmp`;
    writeFileSync(schemaTmp, JSON.stringify(configSchema, null, 2) + "\n", { mode: 0o644 });
    renameSync(schemaTmp, schemaPath);
  }
  return { created: true, path };
}
