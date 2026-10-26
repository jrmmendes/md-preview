import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDaemonState } from "../src/core/state";

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

function runPreview(dir: string, args: string[], pathPrefix?: string) {
  return Bun.spawnSync({
    cmd: [process.execPath, ENTRY, ...args],
    cwd: ROOT,
    env: {
      ...process.env,
      MDPRV_CONFIG_DIR: dir,
      MDPRV_PORT: "0",
      MDPRV_STATE: join(dir, "state", "daemon.json"),
      MDPRV_IDLE: "1",
      ...(pathPrefix ? { PATH: `${pathPrefix}:${process.env.PATH ?? ""}` } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function waitUntil(check: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await Bun.sleep(25);
  }
  return check();
}

async function shutdown(stateFile: string): Promise<void> {
  const state = readDaemonState(stateFile);
  if (!state) {
    return;
  }
  try {
    await fetch(`http://127.0.0.1:${state.port}/__shutdown`, {
      method: "POST",
      headers: { "x-mdprv-token": state.token },
    });
  } catch {
    /* already gone */
  }
  await waitUntil(() => readDaemonState(stateFile) === null);
}

function fakeBrowser(dir: string): { bin: string; marker: string } {
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const marker = join(dir, "browser.log");
  const script = `#!/bin/sh\necho "$1" >> "${marker}"\n`;
  for (const name of ["xdg-open", "open", "explorer.exe"]) {
    writeFileSync(join(bin, name), script, { mode: 0o755 });
  }
  return { bin, marker };
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

describe("preview command line", () => {
  it("documents .mdc, multiple files, --open-browser and --pipe", () => {
    const result = run(tempDir(), ["--help"]);
    expect(result.exitCode).toBe(0);
    const help = result.stdout.toString();
    expect(help).toContain("[files...]");
    expect(help).toContain(".mdc");
    expect(help).toContain("--open-browser");
    expect(help).toContain("--pipe");
  });

  it("rejects unsupported extensions with the accepted list", () => {
    const dir = tempDir();
    const file = join(dir, "notes.txt");
    writeFileSync(file, "not markdown\n");
    const result = run(dir, [file]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(".mdc");
    expect(output(result)).toContain(".markdown");
  });

  it("registers several files without opening a browser", async () => {
    const dir = tempDir();
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    const first = join(dir, "first.md");
    const second = join(dir, "second.mdc");
    writeFileSync(first, "# First\n");
    writeFileSync(second, "---\ntitle: Second\n---\n# Second\n");

    try {
      const result = runPreview(dir, [first, second], bin);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).not.toContain("could not open a browser");
      const urls = result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((line) => line !== "");
      expect(urls).toHaveLength(2);
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(urls[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(urls[0]).not.toContain(".mdc");
      expect(existsSync(marker)).toBe(false);

      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      for (const url of urls) {
        const page = await fetch(url);
        expect(page.status).toBe(200);
      }
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("opens the browser once with --open-browser after registering every file", async () => {
    const dir = tempDir();
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    const first = join(dir, "first.md");
    const second = join(dir, "second.mdc");
    writeFileSync(first, "# First\n");
    writeFileSync(second, "# Second\n");

    try {
      const result = runPreview(dir, [first, second, "--open-browser"], bin);
      expect(result.exitCode).toBe(0);
      const urls = result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((line) => line !== "");
      expect(urls).toHaveLength(2);
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
      const opened = readFileSync(marker, "utf8").trim().split("\n").filter(Boolean);
      expect(opened).toEqual([urls[0]]);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);
});
