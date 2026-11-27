import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-emoji-assets-"));
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

function startWith(dir: string): string {
  const stateFile = join(dir, "state", "daemon.json");
  const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
  daemons.push(daemon);
  return `http://127.0.0.1:${daemon.port}`;
}

function start(): string {
  return startWith(tempDir());
}

function writePack(dir: string, name: string): void {
  const emojis = join(dir, "emojis");
  mkdirSync(emojis, { recursive: true });
  writeFileSync(
    join(emojis, `${name}.json`),
    JSON.stringify({
      schemaVersion: 1,
      name,
      style: "twemoji",
      shortcodes: { smile: "😄" },
    })
  );
}

function writeAsset(dir: string, pack: string, file: string, content: string): void {
  const assets = join(dir, "emojis", "assets", pack);
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, file), content);
}

afterEach(() => {
  for (const daemon of daemons.splice(0)) {
    daemon.stop();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("emoji asset serving", () => {
  it("serves a pack SVG with the right type and supports HEAD", async () => {
    const dir = tempDir();
    writePack(dir, "custom");
    writeAsset(dir, "custom", "smile.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const base = startWith(dir);

    const response = await fetch(`${base}/__emoji-assets/custom/smile.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(await response.text()).toContain("<svg");

    const head = await fetch(`${base}/__emoji-assets/custom/smile.svg`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  }, 15000);

  it("returns 404 for missing files, unknown packs and non-SVG names", async () => {
    const dir = tempDir();
    writePack(dir, "custom");
    writeAsset(dir, "custom", "smile.svg", "<svg/>");
    writeAsset(dir, "custom", "notes.txt", "text");
    const base = startWith(dir);

    expect((await fetch(`${base}/__emoji-assets/custom/missing.svg`)).status).toBe(404);
    expect((await fetch(`${base}/__emoji-assets/unknown/smile.svg`)).status).toBe(404);
    expect((await fetch(`${base}/__emoji-assets/custom/notes.txt`)).status).toBe(404);
    expect((await fetch(`${base}/__emoji-assets/custom/smile.svg.bak`)).status).toBe(404);
  }, 15000);

  it("refuses path traversal and symlinks escaping the asset directory", async () => {
    const dir = tempDir();
    writePack(dir, "custom");
    writeAsset(dir, "custom", "smile.svg", "<svg/>");

    const secret = join(dir, "secret.svg");
    writeFileSync(secret, "<svg>secret</svg>");
    symlinkSync(secret, join(dir, "emojis", "assets", "custom", "escape.svg"));
    const base = startWith(dir);

    for (const path of [
      "/__emoji-assets/custom/%2e%2e%2fsecret.svg",
      "/__emoji-assets/custom/..%2f..%2fsecret.svg",
      "/__emoji-assets/custom/escape.svg",
      "/__emoji-assets/..%2fcustom%2fsmile.svg",
    ]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(404);
    }
  }, 15000);
});
