import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { themeCss, tokenCss } from "../src/core/themes/css";
import { defaultMermaidVariables, mermaidConfig, mermaidPayload } from "../src/core/themes/mermaid";
import { resolveThemeName } from "../src/core/themes/resolve";
import {
  DEFAULT_THEME,
  getTheme,
  hasTheme,
  shikiThemeNames,
  themeNames,
  validateTheme,
  type FixedTheme,
} from "../src/core/themes/tokens";

const CATALOG = join(import.meta.dir, "../src/core/themes/catalog");
const FILES = readdirSync(CATALOG).filter((file) => file.endsWith(".json"));
const COLOR = /^#[0-9a-fA-F]{6}$/;

describe("catalog", () => {
  it("contains every expected theme", () => {
    expect(FILES.sort()).toEqual([
      "auto.json",
      "dracula.json",
      "github-dark.json",
      "github-light.json",
      "gruvbox-dark.json",
      "gruvbox-light.json",
      "nord.json",
      "solarized-dark.json",
      "solarized-light.json",
    ]);
  });

  for (const file of FILES) {
    const fileName = file.replace(/\.json$/, "");
    it(`validates ${file}`, () => {
      const raw = JSON.parse(readFileSync(join(CATALOG, file), "utf8"));
      const theme = validateTheme(fileName, raw);
      expect(theme.name).toBe(fileName);

      if (theme.kind === "auto") {
        expect(hasTheme(theme.variants.light)).toBe(true);
        expect(hasTheme(theme.variants.dark)).toBe(true);
        expect(getTheme(theme.variants.light).kind).not.toBe("auto");
        expect(getTheme(theme.variants.dark).kind).not.toBe("auto");
        return;
      }

      const fixed: FixedTheme = theme;
      expect(Object.keys(fixed.tokens).sort()).toEqual([
        "bg",
        "border",
        "code-bg",
        "fg",
        "link",
        "muted",
        "quote",
      ]);
      for (const color of Object.values(fixed.tokens)) {
        expect(color).toMatch(COLOR);
      }
      expect(fixed.shiki.light.length).toBeGreaterThan(0);
      expect(fixed.shiki.dark.length).toBeGreaterThan(0);
      for (const value of Object.values(fixed.mermaid.overrides)) {
        expect(typeof value).toBe("string");
      }
    });
  }

  it("rejects invalid names, colors and auto shapes", () => {
    expect(() => validateTheme("wrong", { name: "auto", kind: "auto", variants: { light: "a", dark: "b" } })).toThrow();
    expect(() =>
      validateTheme("bad", {
        name: "bad",
        kind: "light",
        tokens: {
          bg: "white",
          fg: "#ffffff",
          muted: "#ffffff",
          link: "#ffffff",
          border: "#ffffff",
          "code-bg": "#ffffff",
          quote: "#ffffff",
        },
        shiki: { light: "x", dark: "x" },
        mermaid: { theme: "default", overrides: {} },
      })
    ).toThrow();
    expect(() =>
      validateTheme("auto", {
        name: "auto",
        kind: "auto",
        variants: { light: "a", dark: "b" },
        tokens: {},
      })
    ).toThrow();
  });
});

describe("themeNames", () => {
  it("returns auto first and the rest alphabetically", () => {
    const names = themeNames();
    expect(names[0]).toBe("auto");
    expect(names.slice(1)).toEqual([...names.slice(1)].sort((a, b) => a.localeCompare(b)));
    expect(names).toHaveLength(FILES.length);
  });
});

describe("themeCss", () => {
  it("uses a single generator for auto and fixed themes", () => {
    const auto = getTheme("auto");
    const autoCss = themeCss(auto);
    expect(autoCss).toContain(`:root{${tokenCss(auto.light.tokens)}}`);
    expect(autoCss).toContain(`@media (prefers-color-scheme: dark){:root{${tokenCss(auto.dark.tokens)}}}`);
    expect(autoCss.match(/prefers-color-scheme/g)).toHaveLength(1);

    const nord = getTheme("nord");
    const fixedCss = themeCss(nord);
    expect(fixedCss).toBe(`:root{${tokenCss(nord.light.tokens)}}`);
    expect(fixedCss).not.toContain("prefers-color-scheme");
  });
});

describe("mermaid", () => {
  it("maps tokens to the default variables", () => {
    const theme = getTheme("nord");
    const vars = defaultMermaidVariables(theme.light.tokens);
    expect(vars.background).toBe(theme.light.tokens.bg);
    expect(vars.mainBkg).toBe(theme.light.tokens["code-bg"]);
    expect(vars.primaryTextColor).toBe(theme.light.tokens.fg);
    expect(vars.lineColor).toBe(theme.light.tokens.link);
    expect(vars.clusterBorder).toBe(theme.light.tokens.border);
    expect(vars.secondaryColor).toBe(theme.light.tokens.muted);
  });

  it("always returns a light/dark payload for every theme", () => {
    for (const name of themeNames()) {
      const theme = getTheme(name);
      const payload = mermaidPayload(theme);
      expect(payload.light.theme.length).toBeGreaterThan(0);
      expect(payload.dark.theme.length).toBeGreaterThan(0);
      expect(typeof payload.light.themeVariables).toBe("object");
      expect(typeof payload.dark.themeVariables).toBe("object");

      if (theme.kind !== "auto") {
        expect(payload.light).toEqual(payload.dark);
        expect(mermaidConfig(theme.light)).toEqual(payload.light);
      }
    }
    expect(mermaidPayload(getTheme("auto")).light).not.toEqual(mermaidPayload(getTheme("auto")).dark);
  });
});

describe("resolveThemeName", () => {
  it("prefers query, then cookie, then fallback", () => {
    expect(resolveThemeName("nord", "dracula", "auto")).toBe("nord");
    expect(resolveThemeName("nope", "dracula", "auto")).toBe("dracula");
    expect(resolveThemeName(null, null, "gruvbox-dark")).toBe("gruvbox-dark");
    expect(resolveThemeName(null, null, "nope")).toBe(DEFAULT_THEME);
  });

  it("exposes every catalog Shiki theme", () => {
    const shiki = shikiThemeNames();
    expect(shiki).toContain("github-light");
    expect(shiki).toContain("github-dark");
    expect(shiki).toContain("solarized-dark");
    expect(shiki).toContain("gruvbox-dark-medium");
  });
});
