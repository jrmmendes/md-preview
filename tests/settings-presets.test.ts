import { describe, expect, it } from "bun:test";

import type {
  PageThemePayload,
  ShikiThemeEntry,
  ThemeCatalogEntry,
  ThemeCatalogPreset,
} from "../src/core/contract";
import {
  BLOCKS_STORAGE_KEY,
  blocksFrom,
  parsePageThemeData,
  presetFor,
  presetValues,
  resolveBlocks,
  resolvePresets,
  themeLabel,
  type Blocks,
  type StoredValues,
} from "../src/ui/islands/settings/catalog";
import {
  THEME_PREFS_COOKIE,
  THEME_PREFS_MERMAID_KEY,
  THEME_PREFS_SHIKI_KEY,
} from "../src/shared/theme-prefs";

function preset(options: Partial<ThemeCatalogPreset> = {}): ThemeCatalogPreset {
  return {
    loader: "classic",
    font: { family: "system-ui", stack: "system-ui, sans-serif" },
    shiki: { light: "github-light", dark: "github-light" },
    mermaid: "default",
    ...options,
  };
}

const AUTO: ThemeCatalogEntry = {
  name: "auto",
  kind: "auto",
  swatch: { background: "#ffffff", text: "#24292f", accent: "#0969da" },
  presets: {
    light: preset(),
    dark: preset({
      shiki: { light: "github-dark", dark: "github-dark" },
      mermaid: "dark",
    }),
  },
};

const NORD: ThemeCatalogEntry = {
  name: "nord",
  kind: "dark",
  swatch: { background: "#2e3440", text: "#d8dee9", accent: "#88c0d0" },
  presets: {
    light: preset({
      loader: "ring",
      shiki: { light: "nord", dark: "nord" },
      mermaid: "neutral",
    }),
    dark: preset({
      loader: "ring",
      shiki: { light: "nord", dark: "nord" },
      mermaid: "neutral",
    }),
  },
};

const THEME: PageThemePayload = {
  name: "auto",
  kind: "auto",
  scheme: "light",
  loaders: { light: "classic", dark: "classic" },
  font: { family: "system-ui", stack: "system-ui, sans-serif" },
  shiki: { light: "github-light", dark: "github-dark" },
  mermaidTheme: { light: "default", dark: "dark" },
};

const SHIKI_THEMES: ShikiThemeEntry[] = [
  { name: "github-light", label: "Github Light", kind: "light", source: "builtin" },
  { name: "github-dark", label: "Github Dark", kind: "dark", source: "builtin" },
  { name: "solarized-light", label: "Solarized Light", kind: "light", source: "builtin" },
  { name: "dracula", label: "Dracula", kind: "dark", source: "builtin" },
  { name: "nord", label: "Nord", kind: "dark", source: "builtin" },
];

const DATA = {
  theme: THEME,
  catalog: [AUTO, NORD],
  shikiThemes: SHIKI_THEMES,
  emojis: [],
};

const NO_BLOCKS: Blocks = { fonte: false, loader: false, codigo: false, graficos: false };

const EMPTY_STORED: StoredValues = {
  font: null,
  loader: null,
  shiki: null,
  mermaid: null,
};

describe("page payload", () => {
  it("parses the server catalog and rejects incomplete payloads", () => {
    const parsed = parsePageThemeData({ theme: THEME, catalog: [AUTO, NORD] });
    expect(parsed?.catalog.map((entry) => entry.name)).toEqual(["auto", "nord"]);
    expect(parsed?.shikiThemes).toEqual([]);
    const withShiki = parsePageThemeData({
      theme: THEME,
      catalog: [AUTO],
      shikiThemes: SHIKI_THEMES,
    });
    expect(withShiki?.shikiThemes.map((theme) => theme.name)).toContain("dracula");
    expect(parsePageThemeData({ theme: THEME })).toBeNull();
    expect(parsePageThemeData({ theme: { name: "auto" }, catalog: [AUTO] })).toBeNull();
    expect(parsePageThemeData(null)).toBeNull();
  });

  it("parses the read-only daemon config and tolerates its absence", () => {
    const config = {
      port: 8766,
      idleMinutes: 15,
      seedThemes: true,
      paths: { config: "/c/config.json", themes: "/c/themes", emojis: "/c/emojis", state: "/s/daemon.json" },
    };
    expect(parsePageThemeData({ theme: THEME, catalog: [AUTO], config })?.config).toEqual(config);
    expect(parsePageThemeData({ theme: THEME, catalog: [AUTO] })?.config).toBeNull();
    expect(
      parsePageThemeData({ theme: THEME, catalog: [AUTO], config: { port: "8766" } })?.config
    ).toBeNull();
  });

  it("labels theme names like the prototype", () => {
    expect(themeLabel("auto")).toBe("Auto");
    expect(themeLabel("github-light")).toBe("Github light");
    expect(themeLabel("gruvbox-dark")).toBe("Gruvbox dark");
    expect(themeLabel("solarized-light")).toBe("Solarized light");
    expect(themeLabel("dracula")).toBe("Dracula");
  });
});

describe("preset resolution", () => {
  it("picks the auto variant for the effective scheme", () => {
    expect(presetFor(DATA, "auto", "light")).toEqual(AUTO.presets.light);
    expect(presetFor(DATA, "auto", "dark")).toEqual(AUTO.presets.dark);
  });

  it("pins a fixed theme to its own kind", () => {
    expect(presetFor(DATA, "nord", "light")).toEqual(NORD.presets.dark);
    expect(presetFor(DATA, "nord", "dark")).toEqual(NORD.presets.dark);
  });

  it("falls back to auto for an unknown theme", () => {
    expect(presetFor(DATA, "missing", "dark")).toEqual(AUTO.presets.dark);
  });

  it("resolves the light and dark presets together", () => {
    const presets = resolvePresets(DATA, "auto", "light");
    expect(presets?.light.shiki.light).toBe("github-light");
    expect(presets?.dark.shiki.dark).toBe("github-dark");
  });
});

describe("customized blocks", () => {
  it("follows the theme presets while not customized", () => {
    const resolved = resolveBlocks({
      blocks: NO_BLOCKS,
      stored: EMPTY_STORED,
      presets: {
        light: AUTO.presets.light,
        dark: AUTO.presets.dark,
      },
      scheme: "light",
      shikiThemes: SHIKI_THEMES,
    });
    expect(resolved.fonte.customized).toBe(false);
    expect(resolved.fonte.value.family).toBe("system-ui");
    expect(resolved.loader.value).toBe("classic");
    expect(resolved.codigo.value).toEqual({
      light: "github-light",
      dark: "github-dark",
    });
    expect(resolved.graficos.value).toEqual({ light: "default", dark: "dark" });
  });

  it("uses stored values for customized blocks", () => {
    const resolved = resolveBlocks({
      blocks: { fonte: true, loader: true, codigo: true, graficos: true },
      stored: {
        font: { family: "Inter", stack: '"Inter", sans-serif', source: "local" },
        loader: "pulse",
        shiki: { light: "solarized-light", dark: "dracula" },
        mermaid: { light: "forest", dark: "neutral" },
      },
      presets: {
        light: AUTO.presets.light,
        dark: AUTO.presets.dark,
      },
      scheme: "light",
      shikiThemes: SHIKI_THEMES,
    });
    expect(resolved.fonte.value.family).toBe("Inter");
    expect(resolved.loader.value).toBe("pulse");
    expect(resolved.codigo.value).toEqual({ light: "solarized-light", dark: "dracula" });
    expect(resolved.graficos.value).toEqual({ light: "forest", dark: "neutral" });
  });

  it("falls back per slot when a stored or preset custom theme is missing", () => {
    const presets = { light: AUTO.presets.light, dark: AUTO.presets.dark };
    const missing = resolveBlocks({
      blocks: { ...NO_BLOCKS, codigo: true },
      stored: { ...EMPTY_STORED, shiki: { light: "tema-ausente", dark: "dracula" } },
      presets,
      scheme: "light",
      shikiThemes: SHIKI_THEMES,
    });
    expect(missing.codigo.value).toEqual({ light: "github-light", dark: "dracula" });

    const present = resolveBlocks({
      blocks: { ...NO_BLOCKS, codigo: true },
      stored: { ...EMPTY_STORED, shiki: { light: "solarized-light", dark: "nord" } },
      presets,
      scheme: "light",
      shikiThemes: SHIKI_THEMES,
    });
    expect(present.codigo.value).toEqual({ light: "solarized-light", dark: "nord" });
  });

  it("falls back to the preset when a customized block has no stored value", () => {
    const resolved = resolveBlocks({
      blocks: { fonte: true, loader: true, codigo: true, graficos: true },
      stored: EMPTY_STORED,
      presets: { light: AUTO.presets.light, dark: AUTO.presets.dark },
      scheme: "dark",
      shikiThemes: SHIKI_THEMES,
    });
    expect(resolved.loader.value).toBe("classic");
    expect(resolved.codigo.value).toEqual({
      light: "github-light",
      dark: "github-dark",
    });
    expect(resolved.graficos.value).toEqual({ light: "default", dark: "dark" });
  });

  it("does not let a theme swap leak into a customized block", () => {
    const stored: StoredValues = {
      font: null,
      loader: "braille",
      shiki: null,
      mermaid: null,
    };
    const nordPresets = { light: NORD.presets.dark, dark: NORD.presets.dark };
    const resolved = resolveBlocks({
      blocks: { ...NO_BLOCKS, loader: true },
      stored,
      presets: nordPresets,
      scheme: "dark",
      shikiThemes: SHIKI_THEMES,
    });
    expect(resolved.loader.value).toBe("braille");
    const inherited = resolveBlocks({
      blocks: NO_BLOCKS,
      stored,
      presets: nordPresets,
      scheme: "dark",
      shikiThemes: SHIKI_THEMES,
    });
    expect(inherited.loader.value).toBe("ring");
  });
});

describe("restoring a block", () => {
  it("rewrites the preset values per block and scheme", () => {
    const presets = { light: AUTO.presets.light, dark: AUTO.presets.dark };
    expect(presetValues("fonte", presets, "light")).toEqual({
      font: { family: "system-ui", stack: "system-ui, sans-serif", source: "local" },
    });
    expect(presetValues("loader", presets, "light")).toEqual({ loader: "classic" });
    expect(presetValues("codigo", presets, "light")).toEqual({
      shiki: { light: "github-light", dark: "github-dark" },
    });
    expect(presetValues("graficos", presets, "light")).toEqual({
      mermaid: { light: "default", dark: "dark" },
    });
  });

  it("restoring after a manual change goes back to the preset", () => {
    const presets = { light: NORD.presets.dark, dark: NORD.presets.dark };
    const manual: StoredValues = {
      font: null,
      loader: null,
      shiki: { light: "dracula", dark: "dracula" },
      mermaid: null,
    };
    expect(manual.shiki).not.toEqual(presetValues("codigo", presets, "dark").shiki);
    expect(presetValues("codigo", presets, "dark")).toEqual({
      shiki: { light: "nord", dark: "nord" },
    });
  });
});

describe("storage contract", () => {
  it("uses the keys documented in the plan", () => {
    expect(BLOCKS_STORAGE_KEY).toBe("mdprv_blocks");
    expect(THEME_PREFS_SHIKI_KEY).toBe("mdprv_shiki");
    expect(THEME_PREFS_MERMAID_KEY).toBe("mdprv_mermaid");
    expect(THEME_PREFS_COOKIE).toBe("mdprv_prefs");
  });

  it("normalizes block flags", () => {
    expect(blocksFrom(null)).toEqual(NO_BLOCKS);
    expect(blocksFrom({ fonte: true, loader: "yes", codigo: 1, graficos: true })).toEqual({
      fonte: true,
      loader: false,
      codigo: false,
      graficos: true,
    });
  });
});
