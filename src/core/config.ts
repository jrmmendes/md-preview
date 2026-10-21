import { homedir } from "node:os";
import { resolve } from "node:path";

import type { LoaderName } from "./contract";
import { DEFAULT_THEME, hasTheme } from "./themes/tokens";

export const DEFAULT_PORT = 8765;
export const DEFAULT_IDLE = 15;
export const DEFAULT_LOADER = "classic";
export const DEFAULT_ZOOM_SENSITIVITY = 1.1;

export type { LoaderName };

export const LOADERS = [
  "classic",
  "dots",
  "bars",
  "ring",
  "pulse",
  "braille",
] as const satisfies readonly LoaderName[];

export type ConfigEnv = Record<string, string | undefined>;

export interface Config {
  port: number;
  idleMs: number;
  stateFile: string;
  theme: string;
  loader: LoaderName;
  zoomSensitivity: number;
}

export function resolveLoaderName(name: string | undefined): LoaderName {
  return name && (LOADERS as readonly string[]).includes(name) ? (name as LoaderName) : DEFAULT_LOADER;
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

function resolvePort(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    return DEFAULT_PORT;
  }
  return n;
}

function resolveIdleMs(value: string | undefined): number {
  const minutes = Number(value);
  const effective = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_IDLE;
  return Math.max(1, effective) * 60 * 1000;
}

export function loadConfig(env: ConfigEnv = process.env): Config {
  const requested = env.MDPRV_THEME?.trim();
  const theme = requested && hasTheme(requested) ? requested : DEFAULT_THEME;
  return {
    port: resolvePort(env.MDPRV_PORT),
    idleMs: resolveIdleMs(env.MDPRV_IDLE),
    stateFile: resolveStateFile(env),
    theme,
    loader: resolveLoaderName(env.MDPRV_LOADER),
    zoomSensitivity: resolveZoomSensitivity(env.MDPRV_ZOOM_SENSITIVITY),
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
  env.MDPRV_LOADER = config.loader;
  env.MDPRV_ZOOM_SENSITIVITY = String(config.zoomSensitivity);
  return env;
}
