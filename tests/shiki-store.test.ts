import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createShikiThemeStore,
  type ShikiThemeChange,
} from "../src/core/themes/shiki-store";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-shiki-store-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function theme(name: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    name,
    type: "dark",
    theme: {
      name,
      colors: { "editor.background": "#101010", "editor.foreground": "#eeeeee" },
    },
    ...extra,
  });
}

describe("createShikiThemeStore", () => {
  it("scans only *.shiki.json direct children", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "minha-paleta.shiki.json"), theme("minha-paleta"));
    writeFileSync(join(dir, "tema.json"), theme("tema"));
    writeFileSync(join(dir, "notes.txt"), "x");
    const store = createShikiThemeStore({ dir, watch: false });
    expect(store.names()).toEqual(["minha-paleta"]);
    expect(store.has("minha-paleta")).toBe(true);
    expect(store.get("minha-paleta")?.kind).toBe("dark");
    expect(store.list()[0]).toEqual({
      name: "minha-paleta",
      label: "Minha Paleta",
      kind: "dark",
      source: "custom",
    });
    store.close();
  });

  it("ignores symlinks and oversized files", () => {
    const dir = tempDir();
    const outside = join(tempDir(), "outside.shiki.json");
    writeFileSync(outside, theme("outside"));
    symlinkSync(outside, join(dir, "link.shiki.json"));
    writeFileSync(
      join(dir, "grande.shiki.json"),
      JSON.stringify({ schemaVersion: 1, name: "grande", theme: {}, pad: "x".repeat(300 * 1024) })
    );
    const store = createShikiThemeStore({ dir, watch: false });
    expect(store.names()).toEqual([]);
    expect(store.errors().some((error) => error.message.includes("256 KiB"))).toBe(true);
    store.close();
  });

  it("detects create, edit and remove after refresh", () => {
    const dir = tempDir();
    const changes: ShikiThemeChange[] = [];
    const store = createShikiThemeStore({
      dir,
      watch: false,
      onChange: (change) => changes.push(change),
    });
    const path = join(dir, "minha-paleta.shiki.json");
    writeFileSync(path, theme("minha-paleta"));
    const created = store.refresh(true);
    expect(created?.changed).toEqual(["minha-paleta"]);
    const firstSha = store.get("minha-paleta")?.sha;

    writeFileSync(path, theme("minha-paleta", { type: "light" }));
    const edited = store.refresh(true);
    expect(edited?.changed).toEqual(["minha-paleta"]);
    expect(store.get("minha-paleta")?.kind).toBe("light");
    expect(store.get("minha-paleta")?.sha).not.toBe(firstSha);

    rmSync(path);
    const removed = store.refresh(true);
    expect(removed?.changed).toEqual(["minha-paleta"]);
    expect(store.names()).toEqual([]);
    expect(changes.map((change) => change.changed)).toEqual([
      ["minha-paleta"],
      ["minha-paleta"],
      ["minha-paleta"],
    ]);
    store.close();
  });

  it("reports invalid and reserved files instead of loading them", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "quebrado.shiki.json"), "{not json");
    writeFileSync(join(dir, "nord.shiki.json"), theme("nord"));
    const store = createShikiThemeStore({ dir, watch: false });
    expect(store.names()).toEqual([]);
    const messages = store.errors().map((error) => error.message);
    expect(messages.some((message) => message.includes("reserved"))).toBe(true);
    expect(messages.some((message) => message.includes("JSON"))).toBe(true);
    store.close();
  });
});
