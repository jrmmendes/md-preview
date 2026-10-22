import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon } from "../src/application/daemon";
import { createFontCatalog, type ExecResult } from "../src/application/daemon/fonts";
import type { Config } from "../src/core/config";
import type { FontsPayload, SlugInfo, SnapshotEvent, VersionEvent } from "../src/core/contract";
import { readDaemonState } from "../src/core/state";
import { VERSION } from "../src/core/version";

function okExec(stdout: string): ExecResult {
  return { ok: true, code: 0, stdout };
}

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

async function register(
  base: string,
  token: string,
  slug: string,
  file: string
): Promise<void> {
  const response = await fetch(`${base}/__register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-mdprv-token": token },
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
      await register(base, daemon.token, "doc", file);

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

      const shutdown = await fetch(`${base}/__shutdown`, {
        method: "POST",
        headers: { "x-mdprv-token": daemon.token },
      });
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
      await register(base, daemon.token, "doc", file);
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

describe("application daemon fonts", () => {
  it("serves the font catalog JSON, caches it and supports refresh and HEAD", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-fonts-"));
    const stateFile = join(dir, "state", "daemon.json");
    let calls = 0;
    const catalog = createFontCatalog({
      now: () => 1_000,
      ttlMs: 60_000,
      exec: async () => {
        calls += 1;
        return okExec("Inter\tRegular\t0\nJetBrains Mono\tRegular\t100\n");
      },
    });
    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50, fontCatalog: catalog });
    const base = `http://127.0.0.1:${daemon.port}`;

    try {
      const response = await fetch(`${base}/__fonts`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as FontsPayload;
      expect(body).toEqual({
        available: true,
        source: "system",
        fonts: [
          { family: "Inter", styles: ["Regular"], category: "sans" },
          { family: "JetBrains Mono", styles: ["Regular"], category: "monospace" },
        ],
        generatedAt: new Date(1_000).toISOString(),
        total: 2,
      });
      expect(calls).toBe(1);

      await fetch(`${base}/__fonts`);
      expect(calls).toBe(1);

      await fetch(`${base}/__fonts?refresh=1`);
      expect(calls).toBe(2);

      const head = await fetch(`${base}/__fonts`, { method: "HEAD" });
      expect(head.status).toBe(200);
      expect(head.headers.get("content-type")).toContain("application/json");
      expect(head.headers.get("cache-control")).toBe("no-store");
      expect(await head.text()).toBe("");
    } finally {
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("returns the generic fallback when fc-list is unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-fonts-fallback-"));
    const stateFile = join(dir, "state", "daemon.json");
    const catalog = createFontCatalog({
      now: () => 0,
      exec: async () => ({ ok: false, code: 127, stdout: "", error: "fc-list missing" }),
    });
    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50, fontCatalog: catalog });
    const base = `http://127.0.0.1:${daemon.port}`;

    try {
      const response = await fetch(`${base}/__fonts`);
      const body = (await response.json()) as FontsPayload;
      expect(body.available).toBe(false);
      expect(body.source).toBe("fallback");
      expect(body.total).toBeGreaterThan(0);
      expect(body.fonts.every((font) => font.category !== undefined)).toBe(true);
    } finally {
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("proxies Google CSS and serves cached font files with asset headers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-fonts-google-"));
    const stateFile = join(dir, "state", "daemon.json");
    const fontBytes = new Uint8Array([9, 8, 7, 6]);
    const hash = createHash("sha256").update(fontBytes).digest("hex");
    const css =
      '@font-face{font-family:"Roboto Slab";src:url(https://fonts.gstatic.com/s/roboto-slab/v1/font.woff2) format("woff2");}';
    const upstream: string[] = [];
    const catalog = createFontCatalog({
      now: () => 0,
      exec: async () => okExec(""),
      fetch: async (input) => {
        upstream.push(input);
        if (input.startsWith("https://fonts.googleapis.com/css2")) {
          return new Response(css, { status: 200, headers: { "Content-Type": "text/css" } });
        }
        if (input === "https://fonts.gstatic.com/s/roboto-slab/v1/font.woff2") {
          return new Response(fontBytes, { status: 200 });
        }
        return new Response("missing", { status: 404 });
      },
    });
    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50, fontCatalog: catalog });
    const base = `http://127.0.0.1:${daemon.port}`;

    try {
      const response = await fetch(`${base}/__fonts/google?family=Roboto+Slab`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.text();
      expect(body).toContain(`/__fonts/file/${hash}`);
      expect(body).not.toContain("fonts.gstatic.com");
      expect(upstream[0]).toBe(
        "https://fonts.googleapis.com/css2?family=Roboto%20Slab&display=swap"
      );

      const headCss = await fetch(`${base}/__fonts/google?family=Roboto+Slab`, {
        method: "HEAD",
      });
      expect(headCss.status).toBe(200);
      expect(headCss.headers.get("content-type")).toBe("text/css; charset=utf-8");
      expect(await headCss.text()).toBe("");

      const file = await fetch(`${base}/__fonts/file/${hash}`);
      expect(file.status).toBe(200);
      expect(file.headers.get("content-type")).toBe("font/woff2");
      expect(file.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(file.headers.get("x-content-type-options")).toBe("nosniff");
      expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...fontBytes]);

      const headFile = await fetch(`${base}/__fonts/file/${hash}`, { method: "HEAD" });
      expect(headFile.status).toBe(200);
      expect(headFile.headers.get("content-type")).toBe("font/woff2");
      expect(await headFile.text()).toBe("");

      const unknown = await fetch(`${base}/__fonts/file/${"0".repeat(64)}`);
      expect(unknown.status).toBe(404);

      const invalid = await fetch(`${base}/__fonts/google?family=Roboto%3Bdrop`);
      expect(invalid.status).toBe(400);
    } finally {
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("rejects external font URLs and reports upstream failures", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-fonts-errors-"));
    const stateFile = join(dir, "state", "daemon.json");
    const catalog = createFontCatalog({
      now: () => 0,
      exec: async () => okExec(""),
      fetch: async (input) => {
        if (input.startsWith("https://fonts.googleapis.com/css2")) {
          return new Response('@font-face{src:url(https://evil.test/font.woff2);}', {
            status: 200,
          });
        }
        return new Response("missing", { status: 404 });
      },
    });
    const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50, fontCatalog: catalog });
    const base = `http://127.0.0.1:${daemon.port}`;

    try {
      const response = await fetch(`${base}/__fonts/google?family=Roboto`);
      expect(response.status).toBe(502);
    } finally {
      daemon.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
