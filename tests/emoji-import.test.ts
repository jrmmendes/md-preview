import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { EmojiPackEntry } from "../src/core/contract";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-emoji-import-"));
  dirs.push(dir);
  return dir;
}

function makeConfig(stateFile: string): Config {
  return {
    port: 0,
    idleMs: 60_000,
    stateFile,
    theme: "auto",
    emoji: "github",
    icons: "breeze",
    loader: "classic",
    loaderFrom: "default",
    zoomSensitivity: 1.1,
    configDir: join(dirname(stateFile), ".."),
    seedThemes: false,
  };
}

afterEach(() => {
  for (const daemon of daemons.splice(0)) {
    daemon.stop();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function start(): { base: string; dir: string; token: string } {
  const dir = tempDir();
  const stateFile = join(dir, "state", "daemon.json");
  const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
  daemons.push(daemon);
  return { base: `http://127.0.0.1:${daemon.port}`, dir, token: daemon.token };
}

function origin(base: string): Record<string, string> {
  return {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
  };
}

function pack(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name,
    style: "native",
    shortcodes: { smile: "😄", rocket: "🚀" },
    ...overrides,
  };
}

describe("emoji import endpoints", () => {
  it("lists the builtin catalog and imports a pack atomically", async () => {
    const { base, dir } = start();
    const emojisDir = join(dir, "emojis");

    const list = await fetch(`${base}/__emojis`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { emojis: EmojiPackEntry[]; errors: unknown[] };
    expect(listed.emojis[0]?.name).toBe("github");
    expect(listed.emojis[0]?.source).toBe("builtin");
    expect(listed.emojis[0]?.count).toBeGreaterThanOrEqual(80);
    expect(listed.errors).toEqual([]);

    const created = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("custom", { label: "Custom" })),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      emoji: EmojiPackEntry;
      emojis: EmojiPackEntry[];
    };
    expect(body.emoji).toEqual({
      name: "custom",
      label: "Custom",
      style: "native",
      source: "user",
      count: 2,
    });
    expect(body.emojis.some((entry) => entry.name === "custom")).toBe(true);

    const file = join(emojisDir, "custom.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).name).toBe("custom");

    const page = await fetch(`${base}/__emojis`);
    expect(((await page.json()) as { emojis: EmojiPackEntry[] }).emojis.map((e) => e.name)).toContain(
      "custom"
    );
  }, 20000);

  it("serves a bounded sample list for the settings preview", async () => {
    const { base } = start();
    const github = (await (await fetch(`${base}/__emoji-samples/github`)).json()) as {
      name: string;
      style: string;
      total: number;
      samples: Array<{ name: string; value: string }>;
    };
    expect(github.name).toBe("github");
    expect(github.style).toBe("native");
    expect(github.total).toBeGreaterThanOrEqual(80);
    expect(github.samples.length).toBeGreaterThan(0);
    expect(github.samples.length).toBeLessThanOrEqual(24);

    expect((await fetch(`${base}/__emoji-samples/nope`)).status).toBe(404);
    expect((await fetch(`${base}/__emoji-samples/../x`)).status).toBe(404);
    const head = await fetch(`${base}/__emoji-samples/github`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect((await head.text()).length).toBe(0);
  }, 20000);

  it("renders shortcodes and falls back to the builtin for unknown slugs", async () => {
    const { base, dir, token } = start();
    const file = join(dir, "doc.md");
    writeFileSync(file, "# Emoji\n\n:rocket: :smile: :nope:\n");
    const registered = await fetch(`${base}/__register`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-mdprv-token": token },
      body: JSON.stringify({ slug: "doc", path: file, content: readFileSync(file, "utf8") }),
    });
    expect(registered.status).toBe(200);

    const page = await (await fetch(`${base}/doc`)).text();
    expect(page).toContain("🚀");
    expect(page).toContain("😄");
    expect(page).toContain(":nope:");

    const missing = await fetch(`${base}/doc?emoji=does-not-exist`);
    expect(missing.status).toBe(200);
    expect(await missing.text()).toContain("🚀");
  }, 20000);

  it("rejects duplicates, builtin slugs, wrong media types and invalid packs", async () => {
    const { base } = start();

    const first = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("custom")),
    });
    expect(first.status).toBe(201);

    const duplicate = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("custom")),
    });
    expect(duplicate.status).toBe(409);

    const builtin = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("github")),
    });
    expect(builtin.status).toBe(409);

    const wrongType = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin", "Content-Type": "text/plain" },
      body: JSON.stringify(pack("other")),
    });
    expect(wrongType.status).toBe(415);

    const foreign = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: { Origin: "https://evil.test", "Content-Type": "application/json" },
      body: JSON.stringify(pack("other")),
    });
    expect(foreign.status).toBe(403);

    const invalid = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("other", { extra: true })),
    });
    expect(invalid.status).toBe(422);

    const badName = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("Bad Name")),
    });
    expect(badName.status).toBe(422);
  }, 20000);

  it("deletes a user pack but never a builtin", async () => {
    const { base } = start();
    const created = await fetch(`${base}/__emojis`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(pack("custom")),
    });
    expect(created.status).toBe(201);

    const remove = await fetch(`${base}/__emojis/custom`, {
      method: "DELETE",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    expect(remove.status).toBe(204);

    const gone = await fetch(`${base}/__emojis/custom`, {
      method: "DELETE",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    expect(gone.status).toBe(404);

    const builtin = await fetch(`${base}/__emojis/github`, {
      method: "DELETE",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    expect(builtin.status).toBe(403);
  }, 20000);
});
