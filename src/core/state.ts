import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DaemonState {
  pid: number;
  port: number;
  token: string;
}

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
  const { pid, port, token } = data as { pid?: unknown; port?: unknown; token?: unknown };
  if (!isPositiveInt(pid) || !isPositiveInt(port) || !isToken(token)) {
    return null;
  }
  return { pid, port, token };
}

export function writeDaemonState(file: string, pid: number, port: number, token: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify({ pid, port, token }), { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

export function clearDaemonState(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
