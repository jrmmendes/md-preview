import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import { createSlugRegistry } from "../src/application/daemon/watch";
import { preview } from "../src/application/cli/commands/preview";
import type { Config } from "../src/core/config";
import type { SnapshotEvent } from "../src/core/contract";
import { isMarkdownExtension, isMarkdownPath } from "../src/core/extensions";
import { slugFor } from "../src/core/slug";

let dir: string;
let daemon: DaemonHandle;
let base: string;
let config: Config;

function makeConfig(stateFile: string): Config {
  return {
    port: 0,
    idleMs: 60_000,
    stateFile,
    theme: "auto",
    loader: "classic",
    zoomSensitivity: 1.1,
    configDir: join(dir, "config"),
    seedThemes: false,
  };
}

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

async function snapshot(): Promise<SnapshotEvent> {
  const controller = new AbortController();
  const response = await fetch(`${base}/__events`, { signal: controller.signal });
  const reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("stream ended before snapshot");
      }
      buffer += decoder.decode(value, { stream: true });
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const block = buffer.slice(0, end);
        const line = block.split("\n").find((item) => item.startsWith("data:"));
        if (!line) {
          throw new Error("snapshot block without data");
        }
        return JSON.parse(line.slice("data:".length).trim()) as SnapshotEvent;
      }
    }
  } finally {
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      /* already closed */
    }
  }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mdprv-preview-"));
  config = makeConfig(join(dir, "state", "daemon.json"));
  daemon = createDaemon(config, { heartbeatMs: 50 });
  base = `http://127.0.0.1:${daemon.port}`;
});

afterAll(() => {
  daemon?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("markdown extensions", () => {
  it("accepts .md, .markdown and .mdc", () => {
    for (const extension of [".md", ".markdown", ".mdc", "MD", ".MDC"]) {
      expect(isMarkdownExtension(extension)).toBe(true);
    }
    expect(isMarkdownExtension(".txt")).toBe(false);
    expect(isMarkdownPath("a.mdc")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(true);
    expect(isMarkdownPath("a.txt")).toBe(false);
  });

  it("strips .mdc when building the slug", () => {
    const file = join(dir, "nested", "rules.mdc");
    expect(slugFor(file).endsWith("nested/rules")).toBe(true);
    expect(slugFor(file)).not.toContain(".mdc");
  });
});

describe("preview command", () => {
  it("registers a .mdc file with normal frontmatter and never opens a browser by default", async () => {
    const file = join(dir, "cursor-rules.mdc");
    writeFileSync(
      file,
      "---\ntitle: Cursor Rules\ntags:\n  - mdc\n---\n# Cursor Rules Body\n\n- keep frontmatter common\n"
    );
    const spy = browserSpy();
    const output = collector();

    const results = await preview(file, { opener: spy.opener, log: output.log }, config);

    expect(results).toHaveLength(1);
    expect(results[0]!.slug.endsWith("cursor-rules")).toBe(true);
    expect(results[0]!.slug).not.toContain(".mdc");
    expect(output.lines).toEqual([results[0]!.url]);
    expect(spy.calls).toEqual([]);

    const page = await fetch(results[0]!.url);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("<title>Cursor Rules</title>");
    expect(html).toMatch(/<h1[^>]*>Cursor Rules Body<\/h1>/);
    expect(html).toContain("keep frontmatter common");
    expect(html).not.toContain("---\ntitle: Cursor Rules");
  });

  it("registers several files and opens the browser once, with the first file active", async () => {
    const first = join(dir, "first.md");
    const second = join(dir, "second.mdc");
    const third = join(dir, "third.markdown");
    writeFileSync(first, "# First\n");
    writeFileSync(second, "# Second\n");
    writeFileSync(third, "# Third\n");
    const spy = browserSpy();
    const output = collector();

    const results = await preview(
      [first, second, third],
      { openBrowser: true, opener: spy.opener, log: output.log },
      config
    );

    expect(results).toHaveLength(3);
    expect(output.lines).toEqual(results.map((result) => result.url));
    expect(new Set(results.map((result) => result.slug)).size).toBe(3);
    expect(spy.calls).toEqual([results[0]!.url]);

    for (const result of results) {
      const page = await fetch(result.url);
      expect(page.status).toBe(200);
    }
  });

  it("collapses repeated files in one invocation", async () => {
    const file = join(dir, "repeat.md");
    writeFileSync(file, "# Repeat\n");
    const spy = browserSpy();
    const output = collector();

    const results = await preview(
      [file, file],
      { openBrowser: true, opener: spy.opener, log: output.log },
      config
    );

    expect(results).toHaveLength(1);
    expect(output.lines).toHaveLength(1);
    expect(spy.calls).toHaveLength(1);
  });

  it("reuses the existing daemon entry for the same real path", async () => {
    const file = join(dir, "reuse.md");
    const alias = join(dir, "reuse-alias.mdc");
    writeFileSync(file, "# Reuse\n");
    symlinkSync(file, alias);
    const spy = browserSpy();
    const output = collector();

    const first = await preview(file, { opener: spy.opener, log: output.log }, config);
    const second = await preview(file, { opener: spy.opener, log: output.log }, config);
    const throughAlias = await preview(alias, { opener: spy.opener, log: output.log }, config);

    expect(second[0]!.slug).toBe(first[0]!.slug);
    expect(second[0]!.url).toBe(first[0]!.url);
    expect(throughAlias[0]!.slug).toBe(first[0]!.slug);
    expect(spy.calls).toEqual([]);

    const current = await snapshot();
    const entries = current.slugs.filter((item) => item.path === file);
    expect(entries).toHaveLength(1);
  });

  it("rejects unsupported extensions and missing files", async () => {
    const text = join(dir, "notes.txt");
    writeFileSync(text, "not markdown\n");
    const spy = browserSpy();

    await expect(preview(text, { opener: spy.opener }, config)).rejects.toThrow(/\.mdc/);
    await expect(preview(join(dir, "missing.md"), { opener: spy.opener }, config)).rejects.toThrow(
      /not a file/
    );
    expect(spy.calls).toEqual([]);
  });
});

describe("slug registry deduplication", () => {
  it("keys entries by real path and reloads without creating another tab", () => {
    const file = join(dir, "registry.md");
    const alias = join(dir, "registry-link.md");
    writeFileSync(file, "# Registry\n");
    symlinkSync(file, alias);
    const registry = createSlugRegistry();

    try {
      const slug = registry.register("registry", file, "# Registry\n");
      const version = registry.get(slug)!.version;

      expect(registry.register("registry", file, "# Registry\n")).toBe(slug);
      expect(registry.register("other-title", file, "# Registry\n")).toBe(slug);
      expect(registry.register("alias", alias, "# Registry\n")).toBe(slug);
      expect(registry.list()).toHaveLength(1);
      expect(registry.findByPath(file)).toBe(slug);
      expect(registry.findByPath(alias)).toBe(slug);
      expect(registry.get(slug)!.version).toBe(version + 3);
      expect(registry.get(slug)!.path).toBe(file);

      expect(registry.register("registry", file, "# Changed\n")).toBe(slug);
      expect(registry.get(slug)!.version).toBe(version + 4);
      expect(registry.list()).toHaveLength(1);
    } finally {
      registry.close();
    }
  });
});
