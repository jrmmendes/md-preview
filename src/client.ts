import { basename } from "node:path";

import {
  clearDaemonState,
  daemonStatePath,
  readDaemonState,
  type DaemonState,
} from "./state";

const DEFAULT_PORT = 8765;

export { daemonStatePath } from "./state";
export type { DaemonState } from "./state";

function portFromEnvironment(): number {
  return Number(process.env.MDPRV_PORT) || DEFAULT_PORT;
}

export async function healthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/__health`, {
      signal: AbortSignal.timeout(300),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function daemonArgv(): string[] {
  const isBunRuntime = /^bun(?:\.exe)?$/i.test(basename(process.execPath));
  return isBunRuntime
    ? [process.execPath, Bun.main, "__serve"]
    : [process.execPath, "__serve"];
}

export async function ensureDaemon(): Promise<DaemonState> {
  const state = readDaemonState();
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    return state;
  }

  const port = portFromEnvironment();
  if (await healthy(port)) {
    return { pid: state?.pid ?? 0, port };
  }

  const child = Bun.spawn(daemonArgv(), {
    cwd: process.cwd(),
    env: { ...process.env, MDPRV_STATE: daemonStatePath() },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100);
    const current = readDaemonState();
    if (current && pidAlive(current.pid) && (await healthy(current.port))) {
      return current;
    }
  }

  throw new Error(`daemon did not become ready on 127.0.0.1:${port}`);
}

export interface RegisterPayload {
  slug: string;
  path: string;
  content: string;
}

export async function registerDocument(
  port: number,
  payload: RegisterPayload
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/__register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) {
    throw new Error(`register failed with status ${res.status}`);
  }
  const data = (await res.json()) as { slug?: unknown };
  if (!data || typeof data.slug !== "string" || data.slug === "") {
    throw new Error("register returned an invalid slug");
  }
  return data.slug;
}

async function waitUntilGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidAlive(pid)) {
      return true;
    }
    await Bun.sleep(100);
  }
  return !pidAlive(pid);
}

export type ShutdownResult = "stopped" | "not-running" | "stale";

export async function shutdownDaemon(): Promise<ShutdownResult> {
  const state = readDaemonState();
  if (!state) {
    return "not-running";
  }

  if (!(await healthy(state.port))) {
    clearDaemonState();
    return "stale";
  }

  try {
    await fetch(`http://127.0.0.1:${state.port}/__shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    /* fall through to signalling */
  }

  let gone = await waitUntilGone(state.pid, 2000);
  if (!gone) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
    gone = await waitUntilGone(state.pid, 1000);
  }
  if (!gone) {
    try {
      process.kill(state.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
    await waitUntilGone(state.pid, 1000);
  }

  clearDaemonState();
  return "stopped";
}

function openers(): string[][] {
  if (process.platform === "darwin") {
    return [["open"]];
  }
  if (process.platform === "win32") {
    return [["explorer.exe"]];
  }
  return [["xdg-open"], ["open"], ["explorer.exe"]];
}

export function openInBrowser(url: string): boolean {
  for (const [command] of openers()) {
    try {
      const child = Bun.spawn([command!, url], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
      return true;
    } catch {
      /* try the next opener */
    }
  }
  return false;
}
