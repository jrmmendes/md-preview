import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { SlugInfo, SnapshotEvent, VersionEvent } from "../src/core/contract";
import { readDaemonState } from "../src/core/state";
import { VERSION } from "../src/core/version";

interface ParsedEvent {
  event: string;
  data: unknown;
}

function parseBlock(block: string): ParsedEvent | null {
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

class SseReader {
  private buffer = "";
  private readonly decoder = new TextDecoder();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next<T = unknown>(type: string, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const index = this.buffer.indexOf("\n\n");
      if (index >= 0) {
        const block = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        const parsed = parseBlock(block);
        if (parsed && parsed.event === type) {
          return parsed.data as T;
        }
        continue;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`timeout waiting for ${type}`);
      }
      const outcome = await Promise.race([
        this.reader.read().then((result) => ({ kind: "read" as const, result })),
        Bun.sleep(remaining).then(() => ({ kind: "timeout" as const })),
      ]);
      if (outcome.kind === "timeout") {
        throw new Error(`timeout waiting for ${type}`);
      }
      if (outcome.result.done) {
        throw new Error(`stream ended waiting for ${type}`);
      }
      this.buffer += this.decoder.decode(outcome.result.value, { stream: true });
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      /* already closed */
    }
  }
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

function makeConfig(stateFile: string, idleMs = 60_000): Config {
  return {
    port: 0,
    idleMs,
    stateFile,
    theme: "auto",
    loader: "classic",
    zoomSensitivity: 1.1,
  };
}

async function register(base: string, slug: string, file: string): Promise<void> {
  const response = await fetch(`${base}/__register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug, path: file, content: readFileSync(file, "utf8") }),
  });
  expect(response.ok).toBe(true);
}

describe("application daemon health", () => {
  it("reports status and version as JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-health-"));
    const stateFile = join(dir, "state", "daemon.json");
    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
    const base = `http://127.0.0.1:${daemon.port}`;

    try {
      const response = await fetch(`${base}/__health`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = (await response.json()) as { status?: unknown; version?: unknown };
      expect(body.status).toBe("ok");
      expect(body.version).toBe(VERSION);
    } finally {
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});

describe("application daemon SSE", () => {
  it("sends snapshot, version and slugs, then shuts down and clears state", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-sse-"));
    const file = join(dir, "doc.md");
    const stateFile = join(dir, "state", "daemon.json");
    writeFileSync(file, "---\ntitle: First\n---\n# First\n");

    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
    const base = `http://127.0.0.1:${daemon.port}`;
    const abort = new AbortController();
    let reader: SseReader | undefined;

    try {
      expect(readDaemonState(stateFile)?.port).toBe(daemon.port);
      await register(base, "doc", file);

      const response = await fetch(`${base}/__events`, { signal: abort.signal });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      reader = new SseReader(response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>);

      const snapshot = await reader.next<SnapshotEvent>("snapshot");
      expect(snapshot.versions.doc).toBe(1);
      expect(snapshot.slugs.some((item) => item.slug === "doc")).toBe(true);

      writeFileSync(file, "---\ntitle: Second\n---\n# Second\n");
      const version = await reader.next<VersionEvent>("version");
      expect(version.slug).toBe("doc");
      expect(version.version).toBeGreaterThan(snapshot.versions.doc);

      const slugs = await reader.next<SlugInfo[]>("slugs");
      expect(slugs.find((item) => item.slug === "doc")?.title).toBe("Second");

      const ping = await reader.next<{ ts: number }>("ping", 2000);
      expect(typeof ping.ts).toBe("number");

      const shutdown = await fetch(`${base}/__shutdown`, { method: "POST" });
      expect(shutdown.ok).toBe(true);
      expect(await waitUntil(() => readDaemonState(stateFile) === null)).toBe(true);
    } finally {
      abort.abort();
      await reader?.cancel();
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("keeps the daemon alive with a connected stream and expires after disconnect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-idle-"));
    const file = join(dir, "doc.md");
    const stateFile = join(dir, "state", "daemon.json");
    writeFileSync(file, "# Idle\n");

    const daemon = createDaemon(makeConfig(stateFile, 200), { heartbeatMs: 40 });
    const base = `http://127.0.0.1:${daemon.port}`;
    const abort = new AbortController();
    let reader: SseReader | undefined;

    try {
      await register(base, "doc", file);
      const response = await fetch(`${base}/__events`, { signal: abort.signal });
      reader = new SseReader(response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>);
      await reader.next<SnapshotEvent>("snapshot");

      await Bun.sleep(900);
      const health = await fetch(`${base}/__health`);
      expect(health.ok).toBe(true);
      expect(readDaemonState(stateFile)).not.toBeNull();

      abort.abort();
      await reader.cancel();
      expect(await waitUntil(() => readDaemonState(stateFile) === null, 4000)).toBe(true);
    } finally {
      abort.abort();
      await reader?.cancel();
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
