import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BUNDLED_ICON_RAW } from "../src/core/icons/builtin";
import { createIconStore } from "../src/core/icons/store";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-icons-"));
  dirs.push(dir);
  return dir;
}

function writePack(dir: string, name: string, icons: Record<string, string>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({ schemaVersion: 1, name, style: "fullcolor", icons }, null, 2)
  );
}

function writeAsset(dir: string, relative: string, content = "<svg/>"): void {
  const full = join(dir, relative);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("icon store", () => {
  it("always exposes the builtin breeze pack", () => {
    const store = createIconStore({ dir: null, watch: false });
    expect(store.names()[0]).toBe("breeze");
    expect(store.has("breeze")).toBe(true);
    const breeze = store.get("breeze");
    expect(Object.keys(breeze.icons).length).toBe(42);
    expect(store.list()[0]).toMatchObject({ name: "breeze", source: "builtin" });
  });

  it("lists breeze as the default builtin and lucide as a second builtin", () => {
    const store = createIconStore({ dir: null, watch: false });
    expect(store.names()).toEqual(["breeze", "lucide"]);
    expect(store.list()).toMatchObject([
      { name: "breeze", source: "builtin", default: true, count: 42 },
      { name: "lucide", source: "builtin", count: 42 },
    ]);
    expect(store.list()[1]?.default).toBeUndefined();
    expect(store.get("lucide").style).toBe("symbolic");
    expect(Object.keys(store.get("lucide").icons)).toHaveLength(42);
  });

  it("never lets a user file shadow a bundled pack", () => {
    const dir = tempDir();
    writePack(dir, "lucide", { copy: "lucide/hijack.svg" });
    writeAsset(dir, "lucide/hijack.svg", "<svg>hijack</svg>");
    const store = createIconStore({ dir, watch: false });

    expect(store.list().filter((item) => item.name === "lucide")).toHaveLength(1);
    expect(store.list().find((item) => item.name === "lucide")).toMatchObject({
      source: "builtin",
      count: 42,
    });
    expect(store.iconValue("lucide", "copy")).toBe("lucide/copy.svg");
  });

  it("merges user packs above builtins and reports user source", () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom/copy.svg");
    const store = createIconStore({ dir, watch: false });
    expect(store.names()).toEqual(["breeze", "custom", "lucide"]);
    expect(store.list().find((item) => item.name === "custom")).toMatchObject({
      source: "user",
      style: "fullcolor",
      count: 1,
    });
    expect(store.iconValue("custom", "copy")).toBe("custom/copy.svg");
    expect(store.hasIcon("custom", "copy")).toBe(true);
    expect(store.hasIcon("custom", "check")).toBe(false);
  });

  it("ignores a user pack with the reserved default name and reports it", () => {
    const dir = tempDir();
    writePack(dir, "breeze", { copy: "breeze/hijack.svg" });
    writeAsset(dir, "breeze/hijack.svg", "<svg>custom</svg>");
    const store = createIconStore({ dir, watch: false });

    expect(store.names().filter((name) => name === "breeze")).toHaveLength(1);
    expect(store.list().find((item) => item.name === "breeze")).toMatchObject({
      source: "builtin",
      default: true,
      style: "symbolic",
    });
    // The embedded manifest still wins: no shadowing of the value or style.
    expect(store.iconValue("breeze", "copy")).toBe("breeze/actions/22/edit-copy-symbolic.svg");
    expect(store.get("breeze").style).toBe("symbolic");
    expect(store.errors()).toEqual([
      {
        file: join(dir, "breeze.json"),
        message: "reserved icon pack name: breeze",
      },
    ]);
  });

  it("silently ignores the untouched copy written by icons seed", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "breeze.json"), JSON.stringify(BUNDLED_ICON_RAW.get("breeze"), null, 2) + "\n");
    const store = createIconStore({ dir, watch: false });
    expect(store.errors()).toEqual([]);
    expect(store.list().find((item) => item.name === "breeze")).toMatchObject({
      source: "builtin",
      default: true,
    });
  });

  it("ignores the legacy default.json without listing or selecting it", () => {
    const dir = tempDir();
    writePack(dir, "default", { copy: "default/copy.svg" });
    writeAsset(dir, "default/copy.svg");
    const store = createIconStore({ dir, watch: false });

    expect(store.has("default")).toBe(false);
    expect(store.names()).toEqual(["breeze", "lucide"]);
    expect(store.list().map((item) => item.name)).toEqual(["breeze", "lucide"]);
    expect(store.get("default").name).toBe("breeze");
    expect(store.errors()).toEqual([
      {
        file: join(dir, "default.json"),
        message: "unsupported legacy icon pack",
      },
    ]);
  });

  it("marks only the builtin default pack as default", () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom/copy.svg");
    const store = createIconStore({ dir, watch: false });
    expect(store.list().filter((item) => item.default === true).map((item) => item.name)).toEqual([
      "breeze",
    ]);
    expect(store.list().find((item) => item.name === "custom")?.default).toBeUndefined();
  });

  it("reports invalid packs without dropping the builtin", () => {
    const dir = tempDir();
    writePack(dir, "broken", { nope: "broken/nope.svg" });
    const store = createIconStore({ dir, watch: false });
    expect(store.has("broken")).toBe(false);
    expect(store.has("breeze")).toBe(true);
    expect(store.errors().some((error) => error.file.includes("broken.json"))).toBe(true);
  });

  it("ignores symlinked pack files", () => {
    const dir = tempDir();
    const real = join(dir, "real.json");
    writeFileSync(real, JSON.stringify({ schemaVersion: 1, name: "linked", icons: { copy: "linked/copy.svg" } }));
    mkdirSync(dir, { recursive: true });
    symlinkSync(real, join(dir, "linked.json"));
    const store = createIconStore({ dir, watch: false });
    expect(store.has("linked")).toBe(false);
  });

  it("emits one change event per refresh with real changes", () => {
    const dir = tempDir();
    const changes: string[][] = [];
    const store = createIconStore({
      dir,
      watch: false,
      onChange: (change) => changes.push(change.changed),
    });
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom/copy.svg");
    expect(store.refresh(true)?.changed).toEqual(["custom"]);
    expect(store.refresh(true)).toBeNull();
    expect(changes).toEqual([["custom"]]);
  });

  it("resolves paths under the icons dir and refuses escapes", () => {
    const dir = tempDir();
    writePack(dir, "custom", { copy: "custom/copy.svg" });
    writeAsset(dir, "custom/copy.svg");
    const store = createIconStore({ dir, watch: false });
    expect(store.assetRoot("custom")).toBe(dir);
    expect(store.iconPath("custom", "copy")).toBe(join(dir, "custom/copy.svg"));
    expect(store.iconPath("custom", "unknown")).toBeNull();
  });
});
