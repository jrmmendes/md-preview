import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmojiStore, type EmojiStore } from "../src/core/emoji/store";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-emoji-store-"));
  dirs.push(dir);
  return dir;
}

function writePack(dir: string, name: string, shortcodes: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({ schemaVersion: 1, name, shortcodes })
  );
}

function open(storeDir: string | null): EmojiStore {
  return createEmojiStore({ dir: storeDir, watch: false });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("emoji store", () => {
  it("merges user packs over the builtin and reports sources", () => {
    const dir = tempDir();
    writePack(dir, "custom", { smile: "😎" });
    const store = open(dir);

    expect(store.names()[0]).toBe("github");
    expect(store.names()).toContain("custom");
    expect(store.has("github")).toBe(true);
    expect(store.has("custom")).toBe(true);
    expect(store.get("missing").name).toBe("github");

    const custom = store.list().find((entry) => entry.name === "custom");
    expect(custom).toEqual({
      name: "custom",
      label: "Custom",
      style: "native",
      source: "user",
      count: 1,
    });
    expect(store.list().find((entry) => entry.name === "github")?.source).toBe("builtin");
  });

  it("lets a hand-written user pack override the builtin slug", () => {
    const dir = tempDir();
    writePack(dir, "github", { smile: "🦄" });
    const store = open(dir);
    expect(store.get("github").shortcodes.smile).toBe("🦄");
    expect(store.list().find((entry) => entry.name === "github")?.source).toBe("user");
  });

  it("collects invalid JSON and invalid packs as errors", () => {
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json"), "{not json");
    writeFileSync(
      join(dir, "invalid.json"),
      JSON.stringify({ schemaVersion: 1, name: "other", shortcodes: {} })
    );
    const store = open(dir);
    expect(store.has("broken")).toBe(false);
    expect(store.has("invalid")).toBe(false);
    expect(store.errors().length).toBe(2);
  });

  it("ignores symlinked packs and keeps scanning without a directory", () => {
    const dir = tempDir();
    const outside = tempDir();
    writePack(outside, "linked", { smile: "😄" });
    mkdirSync(dir, { recursive: true });
    symlinkSync(join(outside, "linked.json"), join(dir, "linked.json"));
    const store = open(dir);
    expect(store.has("linked")).toBe(false);
    store.close();

    const empty = open(null);
    expect(empty.names()).toEqual(["github"]);
    expect(empty.get(null).name).toBe("github");
  });

  it("resolves SVG assets only for safe shortcode names", () => {
    const dir = tempDir();
    writePack(dir, "custom", { smile: "😄" });
    const assets = join(dir, "assets", "custom");
    mkdirSync(assets, { recursive: true });
    writeFileSync(join(assets, "smile.svg"), "<svg/>");
    writeFileSync(join(assets, "bad name.svg"), "<svg/>");
    const store = open(dir);

    expect(store.assetRoot("custom")).toBe(assets);
    expect(store.assetRoot("../custom")).toBeNull();
    expect(store.hasAsset("custom", "smile")).toBe(true);
    expect(store.hasAsset("custom", "bad name")).toBe(false);
    expect(store.hasAsset("custom", "missing")).toBe(false);
    expect(store.hasAsset("nope", "smile")).toBe(false);
  });
});
