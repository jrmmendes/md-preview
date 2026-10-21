import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

import {
  DEFAULT_IDLE,
  DEFAULT_LOADER,
  DEFAULT_PORT,
  DEFAULT_ZOOM_SENSITIVITY,
  LOADERS,
  configToEnv,
  loadConfig,
  resolveLoaderName,
  resolveStateFile,
  resolveZoomSensitivity,
} from "../src/core/config";

describe("loadConfig", () => {
  it("uses defaults for an empty environment", () => {
    const config = loadConfig({});
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.idleMs).toBe(DEFAULT_IDLE * 60 * 1000);
    expect(config.theme).toBe("auto");
    expect(config.loader).toBe(DEFAULT_LOADER);
    expect(config.zoomSensitivity).toBe(DEFAULT_ZOOM_SENSITIVITY);
    expect(config.stateFile.endsWith("md-preview/daemon.json")).toBe(true);
  });

  it("reads every MDPRV_* variable", () => {
    const config = loadConfig({
      MDPRV_PORT: "9001",
      MDPRV_IDLE: "3",
      MDPRV_STATE: "/tmp/mdprv/daemon.json",
      MDPRV_THEME: "nord",
      MDPRV_LOADER: "braille",
      MDPRV_ZOOM_SENSITIVITY: "1.5",
    });
    expect(config.port).toBe(9001);
    expect(config.idleMs).toBe(3 * 60 * 1000);
    expect(config.stateFile).toBe("/tmp/mdprv/daemon.json");
    expect(config.theme).toBe("nord");
    expect(config.loader).toBe("braille");
    expect(config.zoomSensitivity).toBe(1.5);
  });

  it("accepts port 0 for an ephemeral port", () => {
    expect(loadConfig({ MDPRV_PORT: "0" }).port).toBe(0);
  });

  it("falls back on invalid loader, zoom and idle values", () => {
    const config = loadConfig({
      MDPRV_LOADER: "nope",
      MDPRV_ZOOM_SENSITIVITY: "0.5",
      MDPRV_IDLE: "-2",
    });
    expect(config.loader).toBe(DEFAULT_LOADER);
    expect(config.zoomSensitivity).toBe(DEFAULT_ZOOM_SENSITIVITY);
    expect(config.idleMs).toBe(DEFAULT_IDLE * 60 * 1000);
  });

  it("falls back to auto for an unknown theme", () => {
    expect(loadConfig({ MDPRV_THEME: "does-not-exist" }).theme).toBe("auto");
  });
});

describe("resolveStateFile", () => {
  it("prefers MDPRV_STATE and returns an absolute path", () => {
    expect(resolveStateFile({ MDPRV_STATE: "relative/daemon.json" })).toBe(
      resolve("relative/daemon.json")
    );
    expect(resolveStateFile({ MDPRV_STATE: "/tmp/x/daemon.json", XDG_STATE_HOME: "/tmp/y" })).toBe(
      "/tmp/x/daemon.json"
    );
  });

  it("uses XDG_STATE_HOME when MDPRV_STATE is absent", () => {
    expect(resolveStateFile({ XDG_STATE_HOME: "/tmp/xdg" })).toBe(
      resolve("/tmp/xdg", "md-preview/daemon.json")
    );
  });
});

describe("resolvers", () => {
  it("validates loader names", () => {
    for (const loader of LOADERS) {
      expect(resolveLoaderName(loader)).toBe(loader);
    }
    expect(resolveLoaderName("invalid")).toBe(DEFAULT_LOADER);
    expect(resolveLoaderName(undefined)).toBe(DEFAULT_LOADER);
  });

  it("clamps zoom sensitivity", () => {
    expect(resolveZoomSensitivity(undefined)).toBe(1.1);
    expect(resolveZoomSensitivity("1")).toBe(1.1);
    expect(resolveZoomSensitivity("2.5")).toBe(2.5);
    expect(resolveZoomSensitivity("9")).toBe(3);
  });
});

describe("configToEnv", () => {
  it("preserves the base environment and overwrites MDPRV values", () => {
    const config = loadConfig({
      MDPRV_PORT: "9001",
      MDPRV_IDLE: "3",
      MDPRV_STATE: "/tmp/mdprv/daemon.json",
      MDPRV_THEME: "nord",
      MDPRV_LOADER: "ring",
      MDPRV_ZOOM_SENSITIVITY: "1.4",
    });
    const env = configToEnv(config, { PATH: "/bin", MDPRV_THEME: "old", EMPTY: undefined });
    expect(env.PATH).toBe("/bin");
    expect(env.MDPRV_PORT).toBe("9001");
    expect(env.MDPRV_IDLE).toBe("3");
    expect(env.MDPRV_STATE).toBe("/tmp/mdprv/daemon.json");
    expect(env.MDPRV_THEME).toBe("nord");
    expect(env.MDPRV_LOADER).toBe("ring");
    expect(env.MDPRV_ZOOM_SENSITIVITY).toBe("1.4");
    expect("EMPTY" in env).toBe(false);
  });
});
