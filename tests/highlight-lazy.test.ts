import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureShikiTheme,
  getHighlighter,
  resolveShikiSelection,
  warmup,
} from "../src/core/markdown/highlight";
import { renderMarkdown } from "../src/core/markdown/render";
import { setShikiThemeStore } from "../src/core/themes/shiki-index";
import { createShikiThemeStore, type ShikiThemeStore } from "../src/core/themes/shiki-store";

const dirs: string[] = [];
let store: ShikiThemeStore | null = null;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-shiki-lazy-"));
  dirs.push(dir);
  return dir;
}

function writeTheme(dir: string, name: string, background: string): void {
  writeFileSync(
    join(dir, `${name}.shiki.json`),
    JSON.stringify({
      schemaVersion: 1,
      name,
      type: "dark",
      theme: {
        name,
        colors: { "editor.background": background, "editor.foreground": "#eeeeee" },
        tokenColors: [{ settings: { foreground: "#eeeeee" } }],
      },
    })
  );
}

afterEach(() => {
  store?.close();
  store = null;
  setShikiThemeStore(null);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("lazy Shiki loading", () => {
  it("warmup only loads the fallback pair", async () => {
    await warmup();
    const highlighter = await getHighlighter();
    const loaded = highlighter.getLoadedThemes() as string[];
    expect(loaded).toContain("github-light");
    expect(loaded).toContain("github-dark");
    expect(loaded).not.toContain("plastic");
    expect(loaded.length).toBeLessThan(65);
  }, 20000);

  it("loads a builtin on demand and is idempotent", async () => {
    expect(await ensureShikiTheme("tokyo-night")).toBe("tokyo-night");
    expect(await ensureShikiTheme("tokyo-night")).toBe("tokyo-night");
    const loaded = (await getHighlighter()).getLoadedThemes() as string[];
    expect(loaded.filter((name) => name === "tokyo-night")).toHaveLength(1);
  }, 20000);

  it("returns null for unknown names", async () => {
    expect(await ensureShikiTheme("tema-inexistente")).toBeNull();
  }, 20000);

  it("registers custom themes with a content-addressed internal name", async () => {
    const dir = tempDir();
    writeTheme(dir, "minha-paleta", "#101010");
    store = createShikiThemeStore({ dir, watch: false });
    setShikiThemeStore(store);
    const first = await ensureShikiTheme("minha-paleta");
    expect(first).toMatch(/^mdprv-minha-paleta-[0-9a-f]{8}$/);
    expect(await ensureShikiTheme("minha-paleta")).toBe(first);

    writeTheme(dir, "minha-paleta", "#202020");
    store.refresh(true);
    const second = await ensureShikiTheme("minha-paleta");
    expect(second).not.toBe(first);
    expect(second).toMatch(/^mdprv-minha-paleta-[0-9a-f]{8}$/);

    const html = await renderMarkdown("```ts\nconst answer: number = 42;\n```\n", "auto", "doc", {
      themeOverrides: { v: 1, shiki: { light: "minha-paleta", dark: "minha-paleta" } },
    });
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain('<pre class="shiki');
  }, 20000);

  it("falls back per slot when a configured custom theme is missing", async () => {
    expect(resolveShikiSelection("auto", {
      v: 1,
      shiki: { light: "tema-ausente", dark: "dracula" },
    })).toEqual({ light: "github-light", dark: "dracula" });
  });
});
