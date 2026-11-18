import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  clearDaemonState,
  readDaemonState,
  updateDaemonState,
  writeDaemonState,
  type DaemonState,
} from "../src/core/state";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-state-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("daemon state", () => {
  it("writes atomically, reads and clears an explicit state file", () => {
    const dir = tempDir();
    const file = join(dir, "nested", "daemon.json");

    writeDaemonState(file, 1234, 8765, "token-value-1234567890");
    expect(existsSync(file)).toBe(true);
    expect(existsSync(file + ".tmp")).toBe(false);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      pid: 1234,
      port: 8765,
      token: "token-value-1234567890",
    });

    const state: DaemonState | null = readDaemonState(file);
    expect(state).toEqual({ pid: 1234, port: 8765, token: "token-value-1234567890" });

    clearDaemonState(file);
    expect(existsSync(file)).toBe(false);
    expect(readDaemonState(file)).toBeNull();
    expect(() => clearDaemonState(file)).not.toThrow();
  });

  it("returns null for a missing or invalid state file", () => {
    const dir = tempDir();
    const file = join(dir, "daemon.json");
    expect(readDaemonState(file)).toBeNull();

    writeFileSync(file, "{not json");
    expect(readDaemonState(file)).toBeNull();

    writeFileSync(file, JSON.stringify({ pid: -1, port: 8765, token: "token-value-1234567890" }));
    expect(readDaemonState(file)).toBeNull();

    writeFileSync(file, JSON.stringify({ pid: 1, port: 0, token: "token-value-1234567890" }));
    expect(readDaemonState(file)).toBeNull();
  });

  it("keeps separate explicit state files independent", () => {
    const dir = tempDir();
    const first = join(dir, "first.json");
    const second = join(dir, "second.json");
    writeDaemonState(first, 10, 9000, "first-token-1234567890");
    writeDaemonState(second, 20, 9001, "second-token-123456789");
    expect(readDaemonState(first)).toEqual({
      pid: 10,
      port: 9000,
      token: "first-token-1234567890",
    });
    expect(readDaemonState(second)).toEqual({
      pid: 20,
      port: 9001,
      token: "second-token-123456789",
    });
  });

  it("persists browser bookkeeping without losing pid, port or token", () => {
    const dir = tempDir();
    const file = join(dir, "daemon.json");
    writeDaemonState(file, 42, 8123, "token-value-1234567890");

    const updated = updateDaemonState(file, {
      browserOpened: true,
      browserOpenedAt: 1_700_000_000_000,
      browserUrl: "/doc?theme=nord",
    });
    expect(updated).toEqual({
      pid: 42,
      port: 8123,
      token: "token-value-1234567890",
      browserOpened: true,
      browserOpenedAt: 1_700_000_000_000,
      browserUrl: "/doc?theme=nord",
    });
    expect(readDaemonState(file)).toEqual(updated);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(updated);

    const partial = updateDaemonState(file, { browserUrl: "/other" });
    expect(partial?.browserOpened).toBe(true);
    expect(partial?.browserUrl).toBe("/other");

    clearDaemonState(file);
    expect(updateDaemonState(file, { browserOpened: true })).toBeNull();
  });

  it("ignores invalid browser bookkeeping from older or damaged files", () => {
    const dir = tempDir();
    const file = join(dir, "daemon.json");
    writeFileSync(
      file,
      JSON.stringify({
        pid: 1,
        port: 9000,
        token: "token-value-1234567890",
        browserOpened: "yes",
        browserOpenedAt: "soon",
        browserUrl: 7,
      })
    );
    expect(readDaemonState(file)).toEqual({
      pid: 1,
      port: 9000,
      token: "token-value-1234567890",
    });
  });
});
