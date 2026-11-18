import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DaemonState {
  pid: number;
  port: number;
  token: string;
  /** True after this daemon session handed a URL to the platform opener. */
  browserOpened?: boolean;
  /** Epoch milliseconds of the last opener hand-off. */
  browserOpenedAt?: number;
  /** Last URL handed to the browser, kept for diagnostics. */
  browserUrl?: string;
}

export type BrowserSessionPatch = Pick<
  DaemonState,
  "browserOpened" | "browserOpenedAt" | "browserUrl"
>;

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,}$/.test(value);
}

export function readDaemonState(file: string): DaemonState | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const { pid, port, token, browserOpened, browserOpenedAt, browserUrl } = data as {
    pid?: unknown;
    port?: unknown;
    token?: unknown;
    browserOpened?: unknown;
    browserOpenedAt?: unknown;
    browserUrl?: unknown;
  };
  if (!isPositiveInt(pid) || !isPositiveInt(port) || !isToken(token)) {
    return null;
  }
  const state: DaemonState = { pid, port, token };
  // Browser bookkeeping is optional: older state files stay valid.
  if (typeof browserOpened === "boolean") {
    state.browserOpened = browserOpened;
  }
  if (typeof browserOpenedAt === "number" && Number.isFinite(browserOpenedAt)) {
    state.browserOpenedAt = browserOpenedAt;
  }
  if (typeof browserUrl === "string" && browserUrl.length <= 2048) {
    state.browserUrl = browserUrl;
  }
  return state;
}

export function writeDaemonState(
  file: string,
  pid: number,
  port: number,
  token: string,
  browser: Partial<BrowserSessionPatch> = {}
): void {
  mkdirSync(dirname(file), { recursive: true });
  const payload: DaemonState = { pid, port, token };
  if (browser.browserOpened !== undefined) {
    payload.browserOpened = browser.browserOpened;
  }
  if (browser.browserOpenedAt !== undefined) {
    payload.browserOpenedAt = browser.browserOpenedAt;
  }
  if (browser.browserUrl !== undefined) {
    payload.browserUrl = browser.browserUrl;
  }
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

/**
 * Merge browser bookkeeping into an existing state file.
 *
 * Returns `null` when the state file is missing or invalid, so a daemon that
 * lost its state does not recreate a stale entry.
 */
export function updateDaemonState(
  file: string,
  patch: Partial<BrowserSessionPatch>
): DaemonState | null {
  const current = readDaemonState(file);
  if (!current) {
    return null;
  }
  const next: DaemonState = { ...current };
  if (patch.browserOpened !== undefined) {
    next.browserOpened = patch.browserOpened;
  }
  if (patch.browserOpenedAt !== undefined) {
    next.browserOpenedAt = patch.browserOpenedAt;
  }
  if (patch.browserUrl !== undefined) {
    next.browserUrl = patch.browserUrl;
  }
  writeDaemonState(file, next.pid, next.port, next.token, {
    browserOpened: next.browserOpened,
    browserOpenedAt: next.browserOpenedAt,
    browserUrl: next.browserUrl,
  });
  return readDaemonState(file);
}

export function clearDaemonState(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
