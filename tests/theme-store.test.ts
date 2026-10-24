import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createThemeStore } from "../src/core/themes/store";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-themes-"));
  dirs.push(dir);
  return dir;
}

function theme(name: string, background = "#101010", kind: "light" | "dark" = "dark") {
  return {
    schemaVersion: 1,
    name,
    kind,
    colors: {
      background,
      surface: "#181818",
      text: "#eeeeee",
      muted: "#999999",
      border: "#333333",
      accent: "#88c0d0",
      "code-bg": "#202020",
      quote: "#999999",
    },
    shiki: { light: "nord", dark: "nord" },
    mermaid: { theme: "neutral", overrides: {} },
  };
}

function write(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("theme store", () => {
  it("merges builtins and user themes, ordered with auto first", () => {
    const dir = tempDir();
    write(dir, "custom", theme("custom"));
    const store = createThemeStore({ dir, watch: false });
    const names = store.names();
    expect(names[0]).toBe("auto");
    expect(names).toContain("custom");
    expect(names.slice(1)).toEqual([...names.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(store.list().find((item) => item.name === "custom")?.source).toBe("user");
    expect(store.list().find((item) => item.name === "nord")?.source).toBe("builtin");
    store.close();
  });

  it("lets a user theme override a builtin without rewriting it", () => {
    const dir = tempDir();
    write(dir, "nord", theme("nord", "#010203"));
    const store = createThemeStore({ dir, watch: false });
    expect(store.get("nord").light.colors.background).toBe("#010203");
    expect(store.has("nord")).toBe(true);
    store.close();
  });

  it("resolves auto after the merge and sees user variants", () => {
    const dir = tempDir();
    write(dir, "custom", theme("custom", "#0a0a0a"));
    write(dir, "auto", {
      schemaVersion: 1,
      name: "auto",
      kind: "auto",
      variants: { light: "custom", dark: "nord" },
    });
    const store = createThemeStore({ dir, watch: false });
    const auto = store.get("auto");
    expect(auto.light.name).toBe("custom");
    expect(auto.dark.name).toBe("nord");
    store.close();
  });

  it("ignores invalid files and keeps the builtin available", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "nord.json"), "{broken");
    const store = createThemeStore({ dir, watch: false });
    expect(store.get("nord").light.colors.background).toBe("#2e3440");
    expect(store.errors().some((error) => error.file.endsWith("nord.json"))).toBe(true);
    store.close();
  });

  it("reflects create, edit and remove after refresh", () => {
    const dir = tempDir();
    const store = createThemeStore({ dir, watch: false });
    write(dir, "custom", theme("custom"));
    store.refresh(true);
    expect(store.has("custom")).toBe(true);
    write(dir, "custom", theme("custom", "#abcdef"));
    store.refresh(true);
    expect(store.get("custom").light.colors.background).toBe("#abcdef");
    unlinkSync(join(dir, "custom.json"));
    store.refresh(true);
    expect(store.has("custom")).toBe(false);
    store.close();
  });

  it("falls back to auto for an unknown theme", () => {
    const dir = tempDir();
    const store = createThemeStore({ dir, watch: false });
    expect(store.get("missing").name).toBe("auto");
    store.close();
  });

  it("does not follow symlinked theme files", () => {
    const dir = tempDir();
    const outside = join(tempDir(), "outside.json");
    writeFileSync(outside, JSON.stringify(theme("linked")));
    symlinkSync(outside, join(dir, "linked.json"));
    const store = createThemeStore({ dir, watch: false });
    expect(store.has("linked")).toBe(false);
    store.close();
  });
});
