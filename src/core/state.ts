import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DaemonState {
  pid: number;
  port: number;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
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
  const { pid, port } = data as { pid?: unknown; port?: unknown };
  if (!isPositiveInt(pid) || !isPositiveInt(port)) {
    return null;
  }
  return { pid, port };
}

export function writeDaemonState(file: string, pid: number, port: number): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify({ pid, port }));
  renameSync(tmp, file);
}

export function clearDaemonState(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
