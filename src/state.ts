import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

export interface DaemonState {
  pid: number;
  port: number;
}

export function daemonStatePath(): string {
  if (process.env.MDPRV_STATE) {
    return process.env.MDPRV_STATE;
  }
  const base = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return `${base}/md-preview/daemon.json`;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

export function readDaemonState(): DaemonState | null {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(daemonStatePath(), "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") {
    return null;
  }
  const { pid, port } = data as { pid?: unknown; port?: unknown };
  if (!isPositiveInt(pid) || !isPositiveInt(port)) {
    return null;
  }
  return { pid, port };
}

export function writeDaemonState(pid: number, port: number): void {
  const file = daemonStatePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify({ pid, port }));
  renameSync(tmp, file);
}

export function clearDaemonState(): void {
  try {
    rmSync(daemonStatePath(), { force: true });
  } catch {
    /* ignore */
  }
}
