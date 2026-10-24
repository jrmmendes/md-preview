import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { themeCss, tokenCss } from "../src/core/themes/css";
import { defaultMermaidVariables, mermaidConfig, mermaidPayload } from "../src/core/themes/mermaid";
import { resolveThemeName } from "../src/core/themes/resolve";
import {
  DEFAULT_THEME,
  SHIKI_THEME_NAMES,
  getTheme,
  hasTheme,
  shikiThemeNames,
  themeNames,
  validateTheme,
  type FixedTheme,
} from "../src/core/themes/tokens";

const THEMES = join(import.meta.dir, "../themes");
const FILES = readdirSync(THEMES).filter((file) => file.endsWith(".json") && file !== "theme.schema.json");
const COLOR = /^(transparent|#[0-9a-fA-F]{3,8}|(rgba?|hsla?)\(.+\))$/;

describe("builtin themes", () => {
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
      const raw = JSON.parse(readFileSync(join(THEMES, file), "utf8"));
      const theme = validateTheme(fileName, raw);
      expect(theme.name).toBe(fileName);
      expect(theme.schemaVersion).toBe(1);

      if (theme.kind === "auto") {
        expect(hasTheme(theme.variants.light)).toBe(true);
        expect(hasTheme(theme.variants.dark)).toBe(true);
        expect(getTheme(theme.variants.light).kind).not.toBe("auto");
        expect(getTheme(theme.variants.dark).kind).not.toBe("auto");
        return;
      }

      const fixed: FixedTheme = theme;
      for (const key of ["background", "surface", "text", "muted", "border", "accent", "code-bg", "quote"]) {
        expect(fixed.colors[key as keyof typeof fixed.colors]).toMatch(COLOR);
      }
      expect(fixed.radii.md).toBe(6);
      expect(fixed.typography["base-size"]).toBe(17);
      expect(fixed.layout["content-width"]).toBe("46rem");
      expect(SHIKI_THEME_NAMES).toContain(fixed.shiki.light);
      expect(SHIKI_THEME_NAMES).toContain(fixed.shiki.dark);
      for (const value of Object.values(fixed.mermaid.overrides)) {
        expect(typeof value).toBe("string");
      }
    });
  }
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
  it("emits colors, radii, typography, layout and effects", () => {
    const nord = getTheme("nord");
    const fixedCss = themeCss(nord);
    expect(fixedCss).toStartWith(":root{");
    expect(fixedCss).toContain("--mdprv-bg:#2e3440");
    expect(fixedCss).toContain("--mdprv-radius-md:6px");
    expect(fixedCss).toContain("--mdprv-font-stack:");
    expect(fixedCss).toContain("--mdprv-content-width:46rem");
    expect(fixedCss).toContain("--mdprv-shadow-panel:");
    expect(fixedCss).toContain("color-scheme:dark");
    expect(fixedCss).toBe(`:root{${tokenCss(nord.light)}}`);
    expect(fixedCss).not.toContain("prefers-color-scheme");
  });

  it("uses a single generator for auto and repeats the block in dark mode", () => {
    const auto = getTheme("auto");
    const autoCss = themeCss(auto);
    expect(autoCss).toContain("color-scheme:light dark");
    expect(autoCss).toContain("@media (prefers-color-scheme: dark){:root{");
    expect(autoCss.match(/prefers-color-scheme/g)).toHaveLength(1);
    expect(autoCss).toContain(auto.light.colors.background);
    expect(autoCss).toContain(auto.dark.colors.background);
  });
});

describe("mermaid", () => {
  it("maps colors to the default variables", () => {
    const theme = getTheme("nord");
    const vars = defaultMermaidVariables(theme.light.colors);
    expect(vars.background).toBe(theme.light.colors.background);
    expect(vars.mainBkg).toBe(theme.light.colors.surface);
    expect(vars.primaryTextColor).toBe(theme.light.colors.text);
    expect(vars.lineColor).toBe(theme.light.colors.link);
    expect(vars.clusterBorder).toBe(theme.light.colors.border);
    expect(vars.secondaryColor).toBe(theme.light.colors.muted);
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

  it("exposes the full Shiki allowlist", () => {
    expect(shikiThemeNames()).toEqual([...SHIKI_THEME_NAMES]);
    expect(shikiThemeNames()).toContain("gruvbox-dark-medium");
  });
});
