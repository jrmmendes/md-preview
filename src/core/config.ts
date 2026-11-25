import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  configFilePath,
  readConfigFile,
  resolveConfigDir,
  type FileConfig,
  themesDir,
} from "./config-file";
import { DEFAULT_LOADER, isLoaderName, LOADERS, type LoaderName } from "./loader";
import { DEFAULT_THEME, THEME_NAME_RE } from "./themes/constants";

export const DEFAULT_PORT = 8766;
export const DEFAULT_IDLE = 15;
export const DEFAULT_ZOOM_SENSITIVITY = 1.1;
export const DEFAULT_SEED_THEMES = true;

export { DEFAULT_LOADER, isLoaderName, LOADERS };
export type { LoaderName };

export type ConfigEnv = Record<string, string | undefined>;

/** Where the effective loader came from; `default` means "let the theme decide". */
export type LoaderSource = "env" | "file" | "default";

export interface Config {
  port: number;
  idleMs: number;
  stateFile: string;
  theme: string;
  loader: LoaderName;
  loaderFrom: LoaderSource;
  zoomSensitivity: number;
  configDir: string;
  seedThemes: boolean;
}

export interface ConfigLogger {
  warn(message: string): void;
}

export interface LoadConfigOptions {
  configDir?: string;
  readFile?: (path: string) => string | null;
  logger?: ConfigLogger;
  warn?: (message: string) => void;
}

export function resolveLoaderName(name: string | undefined): LoaderName {
  return isLoaderName(name) ? name : DEFAULT_LOADER;
}

export function resolveZoomSensitivity(value: number | string | undefined): number {
  const n = Number(value);
  if (!isFinite(n) || n <= 1) {
    return DEFAULT_ZOOM_SENSITIVITY;
  }
  return Math.min(n, 3);
}

export function resolveStateFile(env: ConfigEnv = process.env): string {
  if (env.MDPRV_STATE) {
    return resolve(env.MDPRV_STATE);
  }
  const base = env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return resolve(base, "md-preview/daemon.json");
}

function resolvePort(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    return DEFAULT_PORT;
  }
  return n;
}

function resolveIdleMs(value: unknown): number {
  const minutes = Number(value);
  const effective = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE;
  return Math.max(1, effective) * 60 * 1000;
}

function resolveThemeName(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const name = value.trim();
  return THEME_NAME_RE.test(name) ? name : undefined;
}

function resolveSeedThemes(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(text)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(text)) {
      return false;
    }
  }
  return undefined;
}

function warnDefault(message: string): void {
  process.stderr.write(`md-preview: ${message}\n`);
}

function readConfig(
  configDir: string,
  options: LoadConfigOptions
): FileConfig {
  const result = readConfigFile(configDir, { readFile: options.readFile });
  const warn = options.warn ?? options.logger?.warn ?? warnDefault;
  for (const error of result.errors) {
    warn(error);
  }
  for (const warning of result.warnings) {
    warn(warning);
  }
  return result.config;
}

export function loadConfig(env: ConfigEnv = process.env, options: LoadConfigOptions = {}): Config {
  const configDir = options.configDir ? resolve(options.configDir) : resolveConfigDir(env);
  const file = readConfig(configDir, options);

  const themed =
    resolveThemeName(env.MDPRV_THEME) ?? resolveThemeName(file.theme) ?? DEFAULT_THEME;
  const seedThemes =
    resolveSeedThemes(env.MDPRV_SEED_THEMES) ??
    resolveSeedThemes(file.seedThemes) ??
    DEFAULT_SEED_THEMES;

  const fromEnv = env.MDPRV_LOADER !== undefined;
  const fromFile = typeof file.loader === "string";
  const loaderFrom: LoaderSource = fromEnv ? "env" : fromFile ? "file" : "default";

  return {
    port: env.MDPRV_PORT !== undefined ? resolvePort(env.MDPRV_PORT) : resolvePort(file.port),
    idleMs:
      env.MDPRV_IDLE !== undefined ? resolveIdleMs(env.MDPRV_IDLE) : resolveIdleMs(file.idle),
    stateFile: resolveStateFile(env),
    theme: themed,
    loader: fromEnv
      ? resolveLoaderName(env.MDPRV_LOADER)
      : resolveLoaderName(typeof file.loader === "string" ? file.loader : undefined),
    loaderFrom,
    zoomSensitivity:
      env.MDPRV_ZOOM_SENSITIVITY !== undefined
        ? resolveZoomSensitivity(env.MDPRV_ZOOM_SENSITIVITY)
        : resolveZoomSensitivity(typeof file.zoomSensitivity === "number" ? file.zoomSensitivity : undefined),
    configDir,
    seedThemes,
  };
}

export function configToEnv(config: Config, base: ConfigEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.MDPRV_PORT = String(config.port);
  env.MDPRV_IDLE = String(Math.max(1, Math.round(config.idleMs / 60000)));
  env.MDPRV_STATE = config.stateFile;
  env.MDPRV_THEME = config.theme;
  // Only forward an explicit choice: otherwise the daemon would always see
  // `MDPRV_LOADER=classic` and the theme preset would never apply.
  if (config.loaderFrom !== "default") {
    env.MDPRV_LOADER = config.loader;
  } else {
    delete env.MDPRV_LOADER;
  }
  env.MDPRV_ZOOM_SENSITIVITY = String(config.zoomSensitivity);
  env.MDPRV_CONFIG_DIR = config.configDir;
  env.MDPRV_SEED_THEMES = config.seedThemes ? "1" : "0";
  return env;
}

export function configThemesDir(config: Config): string {
  return themesDir(config.configDir);
}

export function configFile(config: Config): string {
  return configFilePath(config.configDir);
}
