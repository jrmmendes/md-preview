import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
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

function runPreview(dir: string, args: string[], pathPrefix?: string, cwd = ROOT) {
  return Bun.spawnSync({
    cmd: [process.execPath, ENTRY, ...args],
    cwd,
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

async function openEvents(port: number, doc: string) {
  const controller = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${port}/__events?doc=${encodeURIComponent(doc)}`,
    { signal: controller.signal }
  );
  const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";

  function parse(): { event: string; data: unknown } | null {
    const index = buffer.indexOf("\n\n");
    if (index < 0) {
      return null;
    }
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice("data:".length).trimStart());
      }
    }
    if (data.length === 0) {
      return null;
    }
    try {
      return { event, data: JSON.parse(data.join("\n")) };
    } catch {
      return null;
    }
  }

  return {
    async next<T>(type: string, timeoutMs = 6000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      while (true) {
        const ready = parse();
        if (ready) {
          if (ready.event === type) {
            return ready.data as T;
          }
          continue;
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          throw new Error(`timeout waiting for ${type}`);
        }
        const outcome = await Promise.race([
          reader.read().then((result) => ({ kind: "read" as const, result })),
          Bun.sleep(remaining).then(() => ({ kind: "timeout" as const })),
        ]);
        if (outcome.kind === "timeout") {
          throw new Error(`timeout waiting for ${type}`);
        }
        if (outcome.result.done) {
          throw new Error(`stream ended waiting for ${type}`);
        }
        buffer += decoder.decode(outcome.result.value, { stream: true });
      }
    },
    async close(): Promise<void> {
      controller.abort();
      try {
        await reader.cancel();
      } catch {
        /* already closed */
      }
    },
  };
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
    expect(readdirSync(join(dir, "themes"))).toHaveLength(11);

    const first = run(dir, ["config", "init"]);
    expect(first.exitCode).toBe(0);
    const configPath = join(dir, "config.json");
    expect(existsSync(configPath)).toBe(true);
    writeFileSync(configPath, '{"theme":"nord"}\n');

    const second = run(dir, ["config", "init"]);
    expect(second.exitCode).toBe(0);
    expect(readFileSync(configPath, "utf8")).toBe('{"theme":"nord"}\n');
  });

  it("lists, validates and seeds emoji packs", () => {
    const dir = tempDir();
    const paths = run(dir, ["emoji", "path"]);
    expect(paths.exitCode).toBe(0);
    expect(output(paths)).toContain(`emojis: ${join(dir, "emojis")}`);
    expect(output(paths)).toContain(`assets: ${join(dir, "emojis", "assets")}`);

    const listed = run(dir, ["emoji", "list", "--json"]);
    expect(listed.exitCode).toBe(0);
    const items = JSON.parse(listed.stdout.toString()) as Array<{
      name: string;
      source: string;
      count: number;
    }>;
    expect(items[0]?.name).toBe("github");
    expect(items[0]?.source).toBe("builtin");
    expect(items[0]?.count).toBeGreaterThanOrEqual(80);

    const valid = join(dir, "custom.json");
    writeFileSync(
      valid,
      JSON.stringify({ schemaVersion: 1, name: "custom", shortcodes: { smile: "😄" } })
    );
    expect(run(dir, ["emoji", "validate", valid]).exitCode).toBe(0);

    const invalid = join(dir, "broken.json");
    writeFileSync(invalid, JSON.stringify({ schemaVersion: 2, name: "broken", shortcodes: {} }));
    const bad = run(dir, ["emoji", "validate", invalid]);
    expect(bad.exitCode).toBe(1);
    expect(output(bad)).toContain("schemaVersion");

    const seed = run(dir, ["emoji", "seed"]);
    expect(seed.exitCode).toBe(0);
    expect(readdirSync(join(dir, "emojis")).sort()).toEqual(["emoji.schema.json", "github.json"]);
  });
});

describe("preview command line", () => {
  it("documents .mdc, any text file, multiple paths, both browser flags and --pipe", () => {
    const result = run(tempDir(), ["--help"]);
    expect(result.exitCode).toBe(0);
    const help = result.stdout.toString();
    expect(help).toContain("[paths...]");
    expect(help).toContain("or a directory");
    expect(help).toContain(".mdc");
    expect(help).toContain("text file");
    expect(help).toContain("--open-browser");
    expect(help).toContain("--no-open-browser");
    expect(help).toContain("--pipe");
  });

  it("rejects binary files with a clear message", () => {
    const dir = tempDir();
    const file = join(dir, "photo.png");
    writeFileSync(file, Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01));
    const result = run(dir, [file]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("binary file:");
    expect(readDaemonState(join(dir, "state", "daemon.json"))).toBeNull();
  });

  it("opens the browser by default after registering every file", async () => {
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
      expect(result.stderr.toString()).toContain("opened in browser");
      const urls = result.stdout
        .toString()
        .trim()
        .split("\n")
        .filter((line) => line !== "");
      expect(urls).toHaveLength(2);
      expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(urls[1]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(urls[0]).not.toContain(".mdc");
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
      expect(readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)).toEqual([urls[0]]);

      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      expect(state?.browserOpened).toBe(true);
      expect(state?.browserUrl).toContain("/");
      for (const url of urls) {
        const page = await fetch(url);
        expect(page.status).toBe(200);
      }
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("suppresses the browser with --no-open-browser even on a cold daemon", async () => {
    const dir = tempDir();
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "quiet.md");
    writeFileSync(file, "# Quiet\n");

    try {
      const result = runPreview(dir, [file, "--no-open-browser"], bin);
      expect(result.exitCode).toBe(0);
      expect(result.stderr.toString()).not.toContain("could not open a browser");
      expect(existsSync(marker)).toBe(false);
      expect(readDaemonState(stateFile)?.browserOpened).toBeUndefined();
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("lets the last browser flag on the command line win", async () => {
    const suppressedDir = tempDir();
    const suppressed = fakeBrowser(suppressedDir);
    const suppressedState = join(suppressedDir, "state", "daemon.json");
    const openDir = tempDir();
    const opened = fakeBrowser(openDir);
    const openState = join(openDir, "state", "daemon.json");
    const first = join(suppressedDir, "document.md");
    const second = join(openDir, "document.md");
    writeFileSync(first, "# Doc\n");
    writeFileSync(second, "# Doc\n");

    try {
      const closed = runPreview(
        suppressedDir,
        [first, "--open-browser", "--no-open-browser"],
        suppressed.bin
      );
      expect(closed.exitCode).toBe(0);
      expect(existsSync(suppressed.marker)).toBe(false);
    } finally {
      await shutdown(suppressedState);
    }

    try {
      const force = runPreview(
        openDir,
        [second, "--no-open-browser", "--open-browser"],
        opened.bin
      );
      expect(force.exitCode).toBe(0);
      expect(await waitUntil(() => existsSync(opened.marker))).toBe(true);
    } finally {
      await shutdown(openState);
    }
  }, 20000);

  it("focuses a connected tab on the next run instead of opening the browser again", async () => {
    const dir = tempDir();
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    const first = join(dir, "tab-first.md");
    const second = join(dir, "tab-second.md");
    writeFileSync(first, "# First\n");
    writeFileSync(second, "# Second\n");

    let events: Awaited<ReturnType<typeof openEvents>> | undefined;
    try {
      const initial = runPreview(dir, [first], bin);
      expect(initial.exitCode).toBe(0);
      const firstUrl = initial.stdout.toString().trim().split("\n").find(Boolean)!;
      expect(await waitUntil(() => existsSync(marker))).toBe(true);

      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      const firstSlug = decodeURIComponent(new URL(firstUrl).pathname.slice(1));
      events = await openEvents(state!.port, firstSlug);
      await events.next("snapshot");

      const next = runPreview(dir, [second], bin);
      expect(next.exitCode).toBe(0);
      expect(next.stdout.toString()).toContain("tab-second");
      expect(next.stderr.toString()).toContain("focused existing tab");

      const activated = await events.next<{ slug: string; url: string }>("activate");
      expect(activated.url).toContain("tab-second");
      expect(readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)).toEqual([
        firstUrl,
      ]);

      // --no-open-browser suppresses focus as well as opening.
      const quiet = runPreview(dir, [first, "--no-open-browser"], bin);
      expect(quiet.exitCode).toBe(0);
      await expect(events.next("activate", 700)).rejects.toThrow(/timeout/);
      expect(readFileSync(marker, "utf8").trim().split("\n").filter(Boolean)).toEqual([
        firstUrl,
      ]);
    } finally {
      await events?.close();
      await shutdown(stateFile);
    }
  }, 20000);

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

describe("wrapped documents", () => {
  it("renders a JSON file as a single json fence with the file name as title", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "data.json");
    writeFileSync(file, '{"answer": 42}\n');

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("<title>data.json</title>");
      expect(html).toContain('class="shiki');
      expect(html).toContain('\\"answer\\": 42');
      expect(html).not.toContain("<h1");
      expect((html.match(/class="shiki/g) ?? []).length).toBe(1);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("does not render headings from a .txt file", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "notes.txt");
    writeFileSync(file, "# não é título\n");

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const html = await (await fetch(url)).text();
      expect(html).not.toContain("<h1");
      expect(html).toContain("não é título");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("treats .mdx as a fenced document instead of rendering JSX", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "notes.mdx");
    writeFileSync(file, "<Component />\n");

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const html = await (await fetch(url)).text();
      expect(html).not.toContain("<h1");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("keeps Markdown headings intact", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "doc.md");
    writeFileSync(file, "# Título\n");

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const html = await (await fetch(url)).text();
      expect(html).toContain("<h1");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("highlights the raw view with the detected language", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "data.json");
    writeFileSync(file, '{"answer": 42}\n');

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const slug = decodeURIComponent(new URL(url).pathname.slice(1));
      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      const response = await fetch(
        `http://127.0.0.1:${state!.port}/__raw-highlight?slug=${encodeURIComponent(slug)}`
      );
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('class="shiki');
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("re-renders the fence on live reload without duplicating it", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "data.json");
    writeFileSync(file, '{"answer": 42}\n');

    let events: Awaited<ReturnType<typeof openEvents>> | undefined;
    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const slug = decodeURIComponent(new URL(url).pathname.slice(1));
      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();

      events = await openEvents(state!.port, slug);
      await events.next("snapshot");

      writeFileSync(file, '{"answer": 43}\n');
      await events.next("version");

      const html = await (await fetch(url)).text();
      expect(html).toContain('\\"answer\\": 43');
      expect(html).not.toContain('\\"answer\\": 42');
      expect((html.match(/class="shiki/g) ?? []).length).toBe(1);
    } finally {
      await events?.close();
      await shutdown(stateFile);
    }
  }, 15000);

  it("wraps an extension-less file such as Makefile", async () => {
    const dir = tempDir();
    const stateFile = join(dir, "state", "daemon.json");
    const file = join(dir, "Makefile");
    writeFileSync(file, "all:\n\t@echo hi\n");

    try {
      const result = runPreview(dir, [file, "--no-open-browser"]);
      expect(result.exitCode).toBe(0);
      const url = result.stdout.toString().trim().split("\n").find(Boolean)!;
      const html = await (await fetch(url)).text();
      expect(html).not.toContain("<h1");
      expect(html).toContain("@echo hi");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);
});

describe("directory preview via path", () => {
  it("does not list folder as a command in --help", () => {
    const result = run(tempDir(), ["--help"]);
    expect(result.exitCode).toBe(0);
    const help = result.stdout.toString();
    expect(help).not.toContain("folder");
    expect(help).toContain("[paths...]");
  });

  it("registers every Markdown file and opens index.md first", async () => {
    const dir = tempDir();
    const docs = join(dir, "docs");
    mkdirSync(docs);
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    writeFileSync(join(docs, "zeta.md"), "# Zeta\n");
    writeFileSync(join(docs, "alpha.markdown"), "# Alpha\n");
    writeFileSync(join(docs, "index.md"), "# Index\n");
    writeFileSync(join(docs, "notes.txt"), "not markdown\n");
    mkdirSync(join(docs, "sub"));
    writeFileSync(join(docs, "sub", "nested.md"), "# Nested\n");

    try {
      const result = runPreview(dir, [docs], bin);
      expect(result.exitCode).toBe(0);
      const stdout = result.stdout.toString();
      expect(stdout).not.toContain(docs);
      const lines = stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(3);
      expect(lines.map((line) => line.split(/\s+/)[0])).toEqual([
        "alpha.markdown",
        "index.md",
        "zeta.md",
      ]);
      const urls = lines.map((line) => line.split(/\s+/)[1]!);
      for (const url of urls) {
        expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
        const page = await fetch(url);
        expect(page.status).toBe(200);
      }

      const indexUrl = urls[1]!;
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
      expect(readFileSync(marker, "utf8").trim()).toBe(indexUrl);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("accepts a relative path and the current directory", async () => {
    const dir = tempDir();
    const docs = join(dir, "cwd-docs");
    mkdirSync(docs);
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    writeFileSync(join(docs, "b.md"), "# B\n");
    writeFileSync(join(docs, "a.md"), "# A\n");

    try {
      const result = runPreview(dir, ["."], bin, docs);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      const urls = lines.map((line) => line.split(/\s+/)[1]!);
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
      expect(readFileSync(marker, "utf8").trim()).toBe(urls[0]!);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("applies --theme to every URL of a directory", async () => {
    const dir = tempDir();
    const docs = join(dir, "themed");
    mkdirSync(docs);
    const { bin } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");
    writeFileSync(join(docs, "a.md"), "# A\n");

    try {
      const result = runPreview(dir, [docs, "--theme", "nord"], bin);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("?theme=nord");
      const url = lines[0]!.split(/\s+/)[1]!;
      const page = await fetch(url);
      expect(page.status).toBe(200);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("follows a symlink that points at a directory", async () => {
    const dir = tempDir();
    const docs = join(dir, "real-docs");
    const link = join(dir, "linked-docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "a.md"), "# A\n");
    symlinkSync(docs, link);
    const { bin, marker } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");

    try {
      const result = runPreview(dir, [link], bin);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split(/\s+/)[0]).toBe("a.md");
      expect(await waitUntil(() => existsSync(marker))).toBe(true);
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("treats a directory named like a Markdown file as a directory", async () => {
    const dir = tempDir();
    const weird = join(dir, "notes.md");
    mkdirSync(weird);
    writeFileSync(join(weird, "inner.md"), "# Inner\n");
    const { bin } = fakeBrowser(dir);
    const stateFile = join(dir, "state", "daemon.json");

    try {
      const result = runPreview(dir, ["notes.md"], bin, dir);
      expect(result.exitCode).toBe(0);
      const lines = result.stdout.toString().trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      expect(lines[0]!.split(/\s+/)[0]).toBe("inner.md");
    } finally {
      await shutdown(stateFile);
    }
  }, 15000);

  it("rejects a directory mixed with file paths", () => {
    const dir = tempDir();
    const docs = join(dir, "mixed");
    mkdirSync(docs);
    writeFileSync(join(docs, "a.md"), "# A\n");
    const file = join(dir, "single.md");
    writeFileSync(file, "# Single\n");

    const result = runPreview(dir, [file, docs]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(`not a file: ${docs}`);
    expect(output(result)).toContain("on its own");
  });

  it("treats 'folder' as a path, not a command", () => {
    const dir = tempDir();
    const result = runPreview(dir, ["folder"], undefined, dir);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("path not found: folder");
    expect(output(result)).not.toContain("Usage");
    expect(readDaemonState(join(dir, "state", "daemon.json"))).toBeNull();
  });

  it("reports a missing path with the value given", () => {
    const dir = tempDir();
    const missing = join(dir, "not-here");
    const result = runPreview(dir, [missing]);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain(`path not found: ${missing}`);
    expect(output(result)).not.toContain("Usage");
    expect(readDaemonState(join(dir, "state", "daemon.json"))).toBeNull();
  });

  it("requires a path argument", () => {
    const dir = tempDir();
    const result = runPreview(dir, []);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("missing path argument");
  });

  it("fails clearly when the directory has no Markdown files", () => {
    const dir = tempDir();
    const docs = join(dir, "empty-docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "notes.txt"), "not markdown\n");
    const result = runPreview(dir, [docs], undefined);
    expect(result.exitCode).toBe(1);
    expect(output(result)).toContain("no Markdown files");
    expect(output(result)).toContain(".md");
    expect(readDaemonState(join(dir, "state", "daemon.json"))).toBeNull();
  });
});
