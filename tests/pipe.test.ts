import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
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
import { basename, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import { previewPipe } from "../src/application/cli/commands/preview";
import type { Config } from "../src/core/config";
import { readDaemonState } from "../src/core/state";

const CLI = join(import.meta.dir, "..", "src/application/cli/index.ts");
const UUID_V4 =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const PIPE_NAME_RE = new RegExp(`^temp-${UUID_V4}\\.md$`);
const PIPE_SLUG_RE = new RegExp(`^temp-${UUID_V4}\\.md$`);

let dir: string;
let daemon: DaemonHandle;
let base: string;
let config: Config;
let pipeDir: string;

function browserSpy(): { calls: string[]; opener: (url: string) => boolean } {
  const calls: string[] = [];
  return {
    calls,
    opener(url: string): boolean {
      calls.push(url);
      return true;
    },
  };
}

function collector(): { lines: string[]; log: (line: string) => void } {
  const lines: string[] = [];
  return {
    lines,
    log(line: string): void {
      lines.push(line);
    },
  };
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

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string>,
  stdin?: string
): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (stdin !== undefined) {
    child.stdin?.write(stdin);
    child.stdin?.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    child.exited,
  ]);

  return { exitCode, stdout, stderr };
}

function fakeBrowser(root: string): { bin: string; marker: string } {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const marker = join(root, "browser.log");
  const script = `#!/bin/sh\necho "$1" >> "${marker}"\n`;
  for (const name of ["xdg-open", "open", "explorer.exe"]) {
    writeFileSync(join(bin, name), script, { mode: 0o755 });
  }
  return { bin, marker };
}

function cliEnv(root: string, bin: string): Record<string, string> {
  return {
    MDPRV_CONFIG_DIR: join(root, "config"),
    MDPRV_PORT: "0",
    MDPRV_STATE: join(root, "state", "daemon.json"),
    MDPRV_IDLE: "1",
    MDPRV_TMP_DIR: join(root, "pipes"),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mdprv-pipe-"));
  pipeDir = join(dir, "pipes");
  config = {
    port: 0,
    idleMs: 60_000,
    stateFile: join(dir, "state", "daemon.json"),
    theme: "auto",
    loader: "classic",
    zoomSensitivity: 1.1,
    configDir: join(dir, "config"),
    seedThemes: false,
  };
  daemon = createDaemon(config, { heartbeatMs: 50 });
  base = `http://127.0.0.1:${daemon.port}`;
});

afterAll(() => {
  daemon?.stop();
  rmSync(dir, { recursive: true, force: true });
});

const cliDirs: string[] = [];

afterEach(() => {
  for (const root of cliDirs.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("previewPipe", () => {
  it("writes a temp-<uuid>.md file and registers it without opening a browser", async () => {
    const content = "# Pipe Test\n\nbody from stdin\n";
    const spy = browserSpy();
    const output = collector();

    const result = await previewPipe(
      content,
      { opener: spy.opener, log: output.log },
      config,
      { MDPRV_TMP_DIR: pipeDir }
    );

    const name = basename(result.path);
    expect(name).toMatch(PIPE_NAME_RE);
    expect(result.slug).toMatch(PIPE_SLUG_RE);
    expect(result.slug).toBe(name);
    expect(readFileSync(result.path, "utf8")).toBe(content);
    expect(output.lines).toEqual([result.url]);
    expect(spy.calls).toEqual([]);

    const page = await fetch(result.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/<h1[^>]*>Pipe Test<\/h1>/);
    expect(html).toContain("body from stdin");
  });

  it("creates a new temp document for every pipe", async () => {
    const output = collector();
    const first = await previewPipe("# First\n", { log: output.log }, config, {
      MDPRV_TMP_DIR: pipeDir,
    });
    const second = await previewPipe("# Second\n", { log: output.log }, config, {
      MDPRV_TMP_DIR: pipeDir,
    });

    expect(first.path).not.toBe(second.path);
    expect(first.slug).not.toBe(second.slug);
    expect(existsSync(first.path)).toBe(true);
    expect(existsSync(second.path)).toBe(true);
  });

  it("opens the browser once when requested", async () => {
    const spy = browserSpy();
    const output = collector();
    const result = await previewPipe(
      "# Open Pipe\n",
      { openBrowser: true, opener: spy.opener, log: output.log },
      config,
      { MDPRV_TMP_DIR: pipeDir }
    );

    expect(spy.calls).toEqual([result.url]);
  });

  it("rejects empty stdin content", async () => {
    await expect(
      previewPipe("", {}, config, { MDPRV_TMP_DIR: pipeDir })
    ).rejects.toThrow(/--pipe requires Markdown content on stdin/);
  });
});

describe("--pipe command line", () => {
  it("registers piped Markdown without opening a browser", async () => {
    const root = mkdtempSync(join(tmpdir(), "mdprv-pipe-cli-"));
    cliDirs.push(root);
    const { bin, marker } = fakeBrowser(root);
    const stateFile = join(root, "state", "daemon.json");
    const content = "# test\n";

    try {
      const result = await runCli(["--pipe"], cliEnv(root, bin), content);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("could not open a browser");
      const urls = result.stdout.trim().split("\n").filter(Boolean);
      expect(urls).toHaveLength(1);
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/temp-/);
      const slug = decodeURIComponent(urls[0]!.split("/").pop()!);
      expect(slug).toMatch(PIPE_SLUG_RE);
      expect(existsSync(marker)).toBe(false);

      const files = readdirSync(join(root, "pipes"));
      expect(files).toHaveLength(1);
      expect(files[0]).toMatch(PIPE_NAME_RE);
      expect(readFileSync(join(root, "pipes", files[0]!), "utf8")).toBe(content);

      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      const page = await fetch(urls[0]!);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("test");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("opens the browser once with --pipe --open-browser", async () => {
    const root = mkdtempSync(join(tmpdir(), "mdprv-pipe-browser-"));
    cliDirs.push(root);
    const { bin, marker } = fakeBrowser(root);
    const stateFile = join(root, "state", "daemon.json");

    try {
      const result = await runCli(["--pipe", "--open-browser"], cliEnv(root, bin), "# open\n");

      expect(result.exitCode).toBe(0);
      const urls = result.stdout.trim().split("\n").filter(Boolean);
      expect(urls).toHaveLength(1);
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
      const opened = readFileSync(marker, "utf8").trim().split("\n").filter(Boolean);
      expect(opened).toEqual([urls[0]]);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("rejects --pipe combined with file arguments", async () => {
    const root = mkdtempSync(join(tmpdir(), "mdprv-pipe-args-"));
    cliDirs.push(root);
    const { bin } = fakeBrowser(root);
    const file = join(root, "doc.md");
    writeFileSync(file, "# doc\n");

    const result = await runCli(["--pipe", file], cliEnv(root, bin), "# piped\n");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--pipe cannot be combined with file arguments");
  });

  it("rejects --pipe without stdin data", async () => {
    const root = mkdtempSync(join(tmpdir(), "mdprv-pipe-empty-"));
    cliDirs.push(root);
    const { bin } = fakeBrowser(root);

    const result = await runCli(["--pipe"], cliEnv(root, bin), "");

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--pipe requires Markdown content on stdin");
  });
});
