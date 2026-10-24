import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../src/core/config";
import {
  defaultConfig,
  readConfigFile,
  resolveConfigDir,
  themesDir,
  writeDefaultConfig,
} from "../src/core/config-file";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-config-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("config.json", () => {
  it("merges defaults, file and env with env winning", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ theme: "nord", port: 9100, seedThemes: false })
    );
    const config = loadConfig({}, { configDir: dir });
    expect(config.theme).toBe("nord");
    expect(config.port).toBe(9100);
    expect(config.seedThemes).toBe(false);

    const overridden = loadConfig({ MDPRV_PORT: "9200", MDPRV_SEED_THEMES: "1" }, { configDir: dir });
    expect(overridden.theme).toBe("nord");
    expect(overridden.port).toBe(9200);
    expect(overridden.seedThemes).toBe(true);
  });

  it("uses defaults and reports invalid JSON without throwing", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), "{not json");
    const errors: string[] = [];
    const config = loadConfig({}, { configDir: dir, warn: (message) => errors.push(message) });
    expect(config.theme).toBe("auto");
    expect(config.port).toBe(8766);
    expect(errors.some((message) => message.includes("invalid JSON"))).toBe(true);
  });

  it("ignores unknown keys with a warning", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.json"), JSON.stringify({ theme: "nord", nope: true }));
    const warnings: string[] = [];
    readConfigFile(dir);
    loadConfig({}, { configDir: dir, warn: (message) => warnings.push(message) });
    expect(warnings.some((message) => message.includes("unknown config key"))).toBe(true);
  });

  it("creates config.json and the schema without overwriting", () => {
    const dir = tempDir();
    const first = writeDefaultConfig(dir);
    expect(first.created).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf8"))).toMatchObject(
      defaultConfig()
    );
    expect(readFileSync(join(dir, "config.schema.json"), "utf8")).toContain("md-preview config");

    writeFileSync(join(dir, "config.json"), '{"theme":"nord"}\n');
    const second = writeDefaultConfig(dir);
    expect(second.created).toBe(false);
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe('{"theme":"nord"}\n');
  });

  it("resolves the XDG paths", () => {
    const dir = tempDir();
    expect(resolveConfigDir({ MDPRV_CONFIG_DIR: dir })).toBe(dir);
    expect(themesDir(dir)).toBe(join(dir, "themes"));
  });
});
