import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import { fallbackIconSvg } from "../src/application/daemon/icons-assets";
import type { Config } from "../src/core/config";
import { builtinIconSvg } from "../src/core/icons/builtin";
import { ICON_KEYS } from "../src/core/icons/constants";
import { FALLBACK_ICON_SVG } from "../src/core/icons/defaults";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-icon-assets-"));
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

function writePack(dir: string, name: string, icons: Record<string, string>): void {
  const iconsDir = join(dir, "icons");
  mkdirSync(iconsDir, { recursive: true });
  writeFileSync(
    join(iconsDir, `${name}.json`),
    JSON.stringify({ schemaVersion: 1, name, style: "symbolic", icons })
  );
}

function writeAsset(dir: string, pack: string, file: string, content: string): void {
  const assets = join(dir, "icons", pack);
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

describe("icon asset serving", () => {
  it("serves the builtin pack from memory and supports HEAD", async () => {
    const base = startWith(tempDir());
    const response = await fetch(`${base}/__icon-assets/breeze/copy.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    const body = await response.text();
    expect(body).toContain("<svg");
    expect(body).toContain("</svg>");

    const head = await fetch(`${base}/__icon-assets/breeze/copy.svg`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  }, 15000);

  it("serves the builtin lucide pack from the embedded map", async () => {
    const base = startWith(tempDir());
    const response = await fetch(`${base}/__icon-assets/lucide/copy.svg`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    const body = await response.text();
    expect(body).toBe(builtinIconSvg("lucide", "copy")!);
    expect(body).toContain("<svg");
    expect(body).toContain('stroke="currentColor"');

    const head = await fetch(`${base}/__icon-assets/lucide/copy.svg`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe("image/svg+xml");
    expect(await head.text()).toBe("");

    expect((await fetch(`${base}/__icon-assets/lucide/nope.svg`)).status).toBe(404);
  }, 15000);

  it("serves every lucide key as an embedded SVG", async () => {
    const base = startWith(tempDir());
    for (const key of ICON_KEYS) {
      const response = await fetch(`${base}/__icon-assets/lucide/${key}.svg`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toBe(builtinIconSvg("lucide", key)!);
      expect(body).toContain("<svg");
      expect(body).toContain("</svg>");
    }
  }, 15000);

  it("serves a user asset and data URIs", async () => {
    const dir = tempDir();
    const data = `data:image/svg+xml;base64,${Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>'
    ).toString("base64")}`;
    writePack(dir, "custom", { copy: "custom/copy.svg", check: data });
    writeAsset(dir, "custom", "copy.svg", '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    const base = startWith(dir);

    const asset = await fetch(`${base}/__icon-assets/custom/copy.svg`);
    expect(asset.status).toBe(200);
    expect(await asset.text()).toContain("<rect/>");

    const inline = await fetch(`${base}/__icon-assets/custom/check.svg`);
    expect(inline.status).toBe(200);
    expect(await inline.text()).toContain("<circle");
  }, 15000);

  it("falls back to the builtin pack when the selected pack omits a key", async () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom", "copy.svg", "<svg/>");
    const base = startWith(dir);
    const response = await fetch(`${base}/__icon-assets/custom/check.svg`);
    expect(response.status).toBe(200);
    // Exact builtin glyph, not a user file and not a 404.
    expect(await response.text()).toBe(builtinIconSvg("breeze", "check")!);
  }, 15000);

  it("resolves a missing builtin key to the generic glyph", () => {
    expect(fallbackIconSvg("custom", "check")).toBe(builtinIconSvg("breeze", "check")!);
    expect(fallbackIconSvg("custom", "check", () => null)).toBe(FALLBACK_ICON_SVG);
    expect(fallbackIconSvg("breeze", "copy", () => null)).toBe(FALLBACK_ICON_SVG);
  });

  it("keeps the builtin pack immutable when a user file reuses its name", async () => {
    const dir = tempDir();
    writePack(dir, "breeze", { copy: "breeze/hijack.svg" });
    writeAsset(dir, "breeze", "hijack.svg", "<svg>HIJACK</svg>");
    writeAsset(dir, "breeze", "copy.svg", "<svg>HIJACK-COPY</svg>");
    const base = startWith(dir);

    const response = await fetch(`${base}/__icon-assets/breeze/copy.svg`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("HIJACK");
    expect(body).toBe(builtinIconSvg("breeze", "copy")!);

    // The legacy slug is neither loaded nor served.
    expect((await fetch(`${base}/__icon-assets/default/copy.svg`)).status).toBe(404);
  }, 15000);

  it("returns 404 for unknown packs, unknown keys and non-SVG names", async () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom", "copy.svg", "<svg/>");
    const base = startWith(dir);

    expect((await fetch(`${base}/__icon-assets/unknown/copy.svg`)).status).toBe(404);
    expect((await fetch(`${base}/__icon-assets/custom/nope.svg`)).status).toBe(404);
    expect((await fetch(`${base}/__icon-assets/custom/copy.svg.bak`)).status).toBe(404);
    expect((await fetch(`${base}/__icon-assets/custom/notes.txt`)).status).toBe(404);
  }, 15000);

  it("refuses traversal and never leaks a symlinked file", async () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg", file: "custom/escape.svg" });
    writeAsset(dir, "custom", "copy.svg", "<svg/>");
    const secret = join(dir, "secret.svg");
    writeFileSync(secret, "<svg>secret</svg>");
    symlinkSync(secret, join(dir, "icons", "custom", "escape.svg"));
    const base = startWith(dir);

    for (const path of [
      "/__icon-assets/custom/%2e%2e%2fsecret.svg",
      "/__icon-assets/custom/..%2f..%2fsecret.svg",
      "/__icon-assets/..%2fcustom%2fcopy.svg",
    ]) {
      expect((await fetch(`${base}${path}`)).status).toBe(404);
    }

    // The safe fallback is the builtin glyph, never the file outside the dir.
    const escaped = await fetch(`${base}/__icon-assets/custom/file.svg`);
    expect(await escaped.text()).not.toContain("secret");
  }, 15000);
});
