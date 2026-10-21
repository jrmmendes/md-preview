import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  clearDaemonState,
  readDaemonState,
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
});
