import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "src/application/cli/index.ts");
const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-cli-"));
  dirs.push(dir);
  return dir;
}

function run(dir: string, args: string[]) {
  return Bun.spawnSync({
    cmd: [process.execPath, ENTRY, ...args],
    cwd: ROOT,
    env: { ...process.env, MDPRV_CONFIG_DIR: dir },
    stdout: "pipe",
    stderr: "pipe",
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("theme and config commands", () => {
  it("prints config and theme paths", () => {
    const dir = tempDir();
    const result = run(dir, ["theme", "path"]);
    expect(result.exitCode).toBe(0);
    expect(output(result)).toContain(`config: ${dir}`);
    expect(output(result)).toContain(`themes: ${join(dir, "themes")}`);
  });

  it("lists builtin themes as JSON", () => {
    const dir = tempDir();
    const result = run(dir, ["theme", "list", "--json"]);
    expect(result.exitCode).toBe(0);
    const items = JSON.parse(result.stdout.toString()) as Array<{ name: string; source: string }>;
    expect(items[0]).toEqual({ name: "auto", source: "builtin" });
    expect(items.map((item) => item.name)).toContain("nord");
  });

  it("validates theme files and exits non-zero on errors", () => {
    const dir = tempDir();
    const valid = join(dir, "custom.json");
    writeFileSync(
      valid,
      JSON.stringify({
        schemaVersion: 1,
        name: "custom",
        kind: "dark",
        colors: {
          background: "#000000",
          surface: "#111111",
          text: "#ffffff",
          muted: "#888888",
          border: "#333333",
          accent: "#00aaff",
          "code-bg": "#161616",
          quote: "#888888",
        },
        shiki: { light: "nord", dark: "nord" },
        mermaid: { theme: "dark", overrides: {} },
      })
    );
    const ok = run(dir, ["theme", "validate", valid]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString()).toContain("ok:");

    const invalid = join(dir, "broken.json");
    writeFileSync(invalid, JSON.stringify({ schemaVersion: 2, name: "broken", kind: "dark" }));
    const bad = run(dir, ["theme", "validate", invalid]);
    expect(bad.exitCode).toBe(1);
    expect(output(bad)).toContain("schemaVersion");
  });

  it("seeds themes and initializes config without overwriting", () => {
    const dir = tempDir();
    const seed = run(dir, ["theme", "seed"]);
    expect(seed.exitCode).toBe(0);
    expect(readdirSync(join(dir, "themes"))).toHaveLength(10);

    const first = run(dir, ["config", "init"]);
    expect(first.exitCode).toBe(0);
    const configPath = join(dir, "config.json");
    expect(existsSync(configPath)).toBe(true);
    writeFileSync(configPath, '{"theme":"nord"}\n');

    const second = run(dir, ["config", "init"]);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe('{"theme":"nord"}\n');
  });
});
