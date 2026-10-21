import { basename } from "node:path";

import { configToEnv, type Config } from "../../core/config";
import { clearDaemonState, readDaemonState, type DaemonState } from "../../core/state";

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

export async function ensureDaemon(config: Config): Promise<DaemonState> {
  const state = readDaemonState(config.stateFile);
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    return state;
  }

  if (await healthy(config.port)) {
    throw new Error(
      "a daemon is running without a known token; restart it with `md-preview daemon stop`"
    );
  }

  const child = Bun.spawn(daemonArgv(), {
    cwd: process.cwd(),
    env: configToEnv(config),
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  child.unref();

  for (let i = 0; i < 50; i++) {
    await Bun.sleep(100);
    const current = readDaemonState(config.stateFile);
    if (current && pidAlive(current.pid) && (await healthy(current.port))) {
      return current;
    }
  }

  throw new Error(`daemon did not become ready on 127.0.0.1:${config.port}`);
}

export interface RegisterPayload {
  slug: string;
  path: string;
  content: string;
}

export async function registerDocument(
  port: number,
  payload: RegisterPayload,
  token: string
): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${port}/__register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-mdprv-token": token },
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

export async function shutdownDaemon(config: Config): Promise<ShutdownResult> {
  const state = readDaemonState(config.stateFile);
  if (!state) {
    return "not-running";
  }

  if (!(await healthy(state.port))) {
    clearDaemonState(config.stateFile);
    return "stale";
  }

  try {
    await fetch(`http://127.0.0.1:${state.port}/__shutdown`, {
      method: "POST",
      headers: { "x-mdprv-token": state.token },
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

  clearDaemonState(config.stateFile);
  return "stopped";
}
