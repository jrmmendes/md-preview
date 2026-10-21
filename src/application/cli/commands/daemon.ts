import { loadConfig, type Config } from "../../../core/config";
import { readDaemonState } from "../../../core/state";
import { ensureDaemon, healthy, pidAlive, shutdownDaemon } from "../daemon-client";

export async function daemonStart(config: Config = loadConfig()): Promise<void> {
  const state = readDaemonState(config.stateFile);
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    console.log(`md-preview daemon already running (pid ${state.pid}, port ${state.port})`);
    return;
  }

  if (await healthy(config.port)) {
    const pid = state?.pid ?? 0;
    console.log(`md-preview daemon already running (pid ${pid}, port ${config.port})`);
    return;
  }

  const started = await ensureDaemon(config);
  console.log(`md-preview daemon started (pid ${started.pid}, port ${started.port})`);
}

export async function daemonStop(config: Config = loadConfig()): Promise<void> {
  const result = await shutdownDaemon(config);
  if (result === "not-running") {
    console.log("md-preview daemon is not running");
  } else if (result === "stale") {
    console.log("md-preview daemon was not running (removed stale state)");
  } else {
    console.log("md-preview daemon stopped");
  }
}

export async function daemonStatus(config: Config = loadConfig()): Promise<boolean> {
  const state = readDaemonState(config.stateFile);
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    console.log(`md-preview daemon running (pid ${state.pid}, port ${state.port})`);
    return true;
  }
  console.log("md-preview daemon stopped");
  return false;
}
