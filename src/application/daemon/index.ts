import { randomBytes } from "node:crypto";

import type { Config } from "../../core/config";
import { themesDir } from "../../core/config-file";
import { warmup } from "../../core/markdown/render";
import { clearDaemonState, writeDaemonState } from "../../core/state";
import { getThemeStore, setThemeStore } from "../../core/themes/index";
import { seedThemes as seedThemeFiles } from "../../core/themes/seed";
import { createThemeStore, type ThemeStore } from "../../core/themes/store";
import { createRoutes, type RoutesHandle } from "./routes";
import type { FontCatalog } from "./fonts";
import { createSlugRegistry } from "./watch";

export interface DaemonHandle {
  port: number;
  token: string;
  stop(): void;
  broadcast(event: string, data: unknown): void;
}

export interface CreateDaemonOptions {
  onStop?: () => void;
  heartbeatMs?: number;
  fontCatalog?: FontCatalog;
  themeStore?: ThemeStore;
}

export function createDaemon(config: Config, options: CreateDaemonOptions = {}): DaemonHandle {
  let stopped = false;
  let lastActivity = Date.now();
  let idleTimer: ReturnType<typeof setInterval> | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let handle: DaemonHandle | undefined;
  let routes: RoutesHandle | undefined;
  const token = randomBytes(24).toString("base64url");

  if (!options.themeStore && config.seedThemes) {
    seedThemeFiles({
      dir: themesDir(config.configDir),
      logger: { warn: (message) => process.stderr.write(`${message}\n`) },
    });
  }

  const broadcast = (event: string, data: unknown): void => {
    routes?.broadcast(event, data);
  };

  const themeStore =
    options.themeStore ??
    createThemeStore({
      dir: themesDir(config.configDir),
      watch: true,
      logger: { warn: (message) => process.stderr.write(`${message}\n`) },
      onChange: (change) => broadcast("themes", change),
    });
  setThemeStore(themeStore);


  const registry = createSlugRegistry({
    onVersion: (slug, version) => broadcast("version", { slug, version }),
    onSlugs: (slugs) => broadcast("slugs", slugs),
  });

  function stop(): void {
    if (stopped) {
      return;
    }
    stopped = true;
    if (idleTimer) {
      clearInterval(idleTimer);
      idleTimer = undefined;
    }
    routes?.close();
    registry.close();
    if (!options.themeStore) {
      themeStore.close();
      if (getThemeStore() === themeStore) {
        setThemeStore(null);
      }
    }
    clearDaemonState(config.stateFile);
    try {
      server?.stop(true);
    } catch {
      /* ignore */
    }
    options.onStop?.();
  }

  routes = createRoutes({
    config,
    themes: themeStore,
    registry,
    token,
    heartbeatMs: options.heartbeatMs,
    fonts: options.fontCatalog,
    onActivity: () => {
      lastActivity = Date.now();
    },
    requestShutdown: () => handle?.stop(),
  });

  server = Bun.serve({
    hostname: "127.0.0.1",
    port: config.port,
    idleTimeout: 0,
    fetch: routes.handle,
  });

  const port = server.port ?? config.port;

  const daemonHandle: DaemonHandle = { port, token, stop, broadcast };
  handle = daemonHandle;

  writeDaemonState(config.stateFile, process.pid, port, token);

  const tick = Math.max(500, Math.min(30000, Math.floor(config.idleMs / 2)));
  idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > config.idleMs) {
      stop();
    }
  }, tick);

  void warmup();

  return daemonHandle;
}

export function startDaemon(config: Config): DaemonHandle {
  try {
    return createDaemon(config, { onStop: () => process.exit(0) });
  } catch (err) {
    process.stderr.write(`md-preview: could not bind 127.0.0.1:${config.port}: ${String(err)}\n`);
    process.exit(1);
  }
}
