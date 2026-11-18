import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import { createSlugRegistry } from "../src/application/daemon/watch";
import type { FolderResult } from "../src/application/cli/commands/folder";
import { preview } from "../src/application/cli/commands/preview";
import { previewTarget } from "../src/application/cli/commands/target";
import type { Config } from "../src/core/config";
import type { ActivateEvent, SnapshotEvent } from "../src/core/contract";
import { isMarkdownExtension, isMarkdownPath } from "../src/core/extensions";
import { encodeSlugPath, slugFor } from "../src/core/slug";

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

interface EventCursor {
  next<T>(type: string, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

async function openEvents(doc?: string): Promise<EventCursor> {
  const controller = new AbortController();
  const query = doc ? `?doc=${encodeURIComponent(doc)}` : "";
  const response = await fetch(`${base}/__events${query}`, { signal: controller.signal });
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
    async next<T>(type: string, timeoutMs = 4000): Promise<T> {
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
  it("opens the browser by default on a cold daemon", async () => {
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
    expect(spy.calls).toEqual([results[0]!.url]);

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

    const first = await preview(file, { openBrowser: false, opener: spy.opener, log: output.log }, config);
    const second = await preview(file, { openBrowser: false, opener: spy.opener, log: output.log }, config);
    const throughAlias = await preview(alias, { openBrowser: false, opener: spy.opener, log: output.log }, config);

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

describe("tab activation", () => {
  it("focuses the tab already on the document and never calls the opener", async () => {
    const file = join(dir, "activate-same.md");
    writeFileSync(file, "# Same\n");
    const spy = browserSpy();
    const output = collector();

    const [result] = await preview(
      file,
      { openBrowser: false, opener: spy.opener, log: output.log },
      config
    );
    const events = await openEvents(result!.slug);
    try {
      await events.next("snapshot");
      const again = await preview(
        file,
        { opener: spy.opener, log: output.log },
        config
      );
      expect(again[0]!.url).toBe(result!.url);
      const event = await events.next<ActivateEvent>("activate");
      expect(event.slug).toBe(result!.slug);
      expect(event.url).toBe(`/${encodeSlugPath(result!.slug)}`);
      expect(spy.calls).toEqual([]);
    } finally {
      await events.close();
    }
  });

  it("navigates a connected tab to another document instead of opening a tab", async () => {
    const first = join(dir, "activate-one.md");
    const second = join(dir, "activate-two.md");
    writeFileSync(first, "# One\n");
    writeFileSync(second, "# Two\n");
    const spy = browserSpy();
    const output = collector();

    const [firstResult] = await preview(
      first,
      { openBrowser: false, opener: spy.opener, log: output.log },
      config
    );
    const events = await openEvents(firstResult!.slug);
    try {
      await events.next("snapshot");
      const [secondResult] = await preview(
        second,
        { opener: spy.opener, log: output.log },
        config
      );
      expect(spy.calls).toEqual([]);
      const event = await events.next<ActivateEvent>("activate");
      expect(event.slug).toBe(secondResult!.slug);
      expect(event.url).toBe(`/${encodeSlugPath(secondResult!.slug)}`);
    } finally {
      await events.close();
    }
  });
});

describe("path target", () => {
  it("dispatches a directory to the folder preview and opens the index", async () => {
    const docs = join(dir, "target-docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "b.md"), "# B\n");
    writeFileSync(join(docs, "index.md"), "# Index\n");
    const spy = browserSpy();
    const output = collector();

    const result = await previewTarget(
      docs,
      { theme: "nord", opener: spy.opener, log: output.log },
      config
    );

    expect(Array.isArray(result)).toBe(false);
    const folder = result as FolderResult;
    expect(folder.entries.map((entry) => entry.name)).toEqual(["b.md", "index.md"]);
    expect(folder.opened).toBe(folder.entries[1]!.url);
    expect(folder.opened).toContain("?theme=nord");
    expect(spy.calls).toEqual([folder.opened]);
    expect(output.lines).toHaveLength(2);

    const page = await fetch(folder.opened);
    expect(page.status).toBe(200);
  });

  it("dispatches a file to the file preview", async () => {
    const file = join(dir, "target-file.md");
    writeFileSync(file, "# Target\n");
    const output = collector();

    const result = await previewTarget(file, { log: output.log }, config);

    expect(Array.isArray(result)).toBe(true);
    const results = result as Array<{ url: string }>;
    expect(results).toHaveLength(1);
    const page = await fetch(results[0]!.url);
    expect(page.status).toBe(200);
  });

  it("rejects missing paths and directories mixed with files", async () => {
    const docs = join(dir, "mixed-docs");
    mkdirSync(docs);
    writeFileSync(join(docs, "a.md"), "# A\n");
    const file = join(dir, "mixed-file.md");
    writeFileSync(file, "# File\n");

    await expect(previewTarget(join(dir, "nope.md"), {}, config)).rejects.toThrow(
      /path not found/
    );
    await expect(previewTarget([file, docs], {}, config)).rejects.toThrow(/on its own/);
  });

  it("rejects a directory without Markdown files", async () => {
    const empty = join(dir, "empty-target");
    mkdirSync(empty);
    writeFileSync(join(empty, "notes.txt"), "not markdown\n");

    await expect(previewTarget(empty, {}, config)).rejects.toThrow(/no Markdown files/);
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
      // Identical content must not bump the version: a repeated CLI call
      // points the open tab at the document instead of reloading it.
      expect(registry.get(slug)!.version).toBe(version);
      expect(registry.get(slug)!.path).toBe(file);

      expect(registry.register("registry", file, "# Changed\n")).toBe(slug);
      expect(registry.get(slug)!.version).toBe(version + 1);
      expect(registry.list()).toHaveLength(1);
    } finally {
      registry.close();
    }
  });
});
