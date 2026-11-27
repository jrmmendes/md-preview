import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type {
  MermaidThemeEntry,
  ShikiThemeEntry,
  ThemeCatalogEntry,
  ThemeCatalogPreset,
} from "../src/core/contract";
import {
  parsePageThemeData,
  type PageThemeData,
} from "../src/ui/islands/settings/catalog";
import {
  cloneSnapshot,
  commitSnapshot,
  discardSnapshot,
  effectiveBlocks,
  isDraftDirty,
  needsReload,
  restoreDraftBlock,
  setDraftCustomized,
  setDraftExample,
  setDraftFont,
  setDraftSimpleTables,
  setDraftTableWrap,
  setDraftTheme,
  setDraftZoom,
  type SettingsSnapshot,
} from "../src/ui/islands/settings/draft";

function preset(options: Partial<ThemeCatalogPreset> = {}): ThemeCatalogPreset {
  return {
    loader: "classic",
    font: { family: "system-ui", stack: "system-ui, sans-serif" },
    shiki: { light: "github-light", dark: "github-dark" },
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
    dark: preset({ shiki: { light: "dracula", dark: "dracula" }, mermaid: "dark" }),
  },
};

const NORD: ThemeCatalogEntry = {
  name: "nord",
  kind: "dark",
  swatch: { background: "#2e3440", text: "#d8dee9", accent: "#88c0d0" },
  presets: {
    light: preset({ loader: "ring", shiki: { light: "nord", dark: "nord" }, mermaid: "neutral" }),
    dark: preset({ loader: "ring", shiki: { light: "nord", dark: "nord" }, mermaid: "neutral" }),
  },
};

const SHIKI_THEMES: ShikiThemeEntry[] = [
  { name: "github-light", label: "Github Light", kind: "light", source: "builtin" },
  { name: "github-dark", label: "Github Dark", kind: "dark", source: "builtin" },
  { name: "dracula", label: "Dracula", kind: "dark", source: "builtin" },
  { name: "nord", label: "Nord", kind: "dark", source: "builtin" },
];

const MERMAID_THEMES: MermaidThemeEntry[] = [
  { name: "default", label: "Default", source: "builtin", theme: "default", variables: {} },
  { name: "neutral", label: "Neutral", source: "builtin", theme: "neutral", variables: {} },
  { name: "dark", label: "Dark", source: "builtin", theme: "dark", variables: {} },
];

const DATA: PageThemeData = parsePageThemeData({
  theme: {
    name: "auto",
    kind: "auto",
    scheme: "light",
    loaders: { light: "classic", dark: "classic" },
    font: { family: "system-ui", stack: "system-ui, sans-serif" },
    shiki: { light: "github-light", dark: "github-dark" },
    mermaidTheme: { light: "default", dark: "dark" },
  },
  catalog: [AUTO, NORD],
  shikiThemes: SHIKI_THEMES,
  mermaidThemes: MERMAID_THEMES,
}) as PageThemeData;

const APPLIED: SettingsSnapshot = {
  themeName: "auto",
  scheme: "light",
  blocks: { fonte: false, loader: false, codigo: false, graficos: false },
  stored: { font: null, loader: null, shiki: null, mermaid: null },
  emojiName: "github",
  exampleId: "fluxo",
  zoom: 1.1,
  simpleTables: false,
  simpleDiffs: false,
  tableWrap: false,
};

const PRESETS = { light: AUTO.presets.light, dark: AUTO.presets.dark };

describe("settings draft", () => {
  it("starts clean and clones without sharing nested objects", () => {
    const draft = cloneSnapshot(APPLIED);
    expect(isDraftDirty(APPLIED, draft)).toBe(false);
    draft.stored.shiki = { light: "dracula", dark: "dracula" };
    draft.blocks.codigo = true;
    expect(APPLIED.stored.shiki).toBeNull();
    expect(APPLIED.blocks.codigo).toBe(false);
    expect(isDraftDirty(APPLIED, draft)).toBe(true);
  });

  it("changes stay in the draft until commit and are thrown away on discard", () => {
    let draft = cloneSnapshot(APPLIED);
    draft = setDraftFont(draft, {
      family: "Inter",
      stack: '"Inter", sans-serif',
      source: "local",
    });
    expect(isDraftDirty(APPLIED, draft)).toBe(true);
    expect(APPLIED.stored.font).toBeNull();

    const committed = commitSnapshot(APPLIED, draft);
    expect(committed.stored.font?.family).toBe("Inter");
    // Commit returns a copy, it never mutates the previous applied snapshot.
    expect(APPLIED.stored.font).toBeNull();

    const discarded = discardSnapshot(APPLIED);
    expect(discarded.stored.font).toBeNull();
    expect(isDraftDirty(APPLIED, discarded)).toBe(false);
  });

  it("enables a block with the theme preset and clears it when disabled", () => {
    const enabled = setDraftCustomized(APPLIED, "codigo", true, PRESETS, "light");
    expect(enabled.blocks.codigo).toBe(true);
    expect(enabled.stored.shiki).toEqual({
      light: "github-light",
      dark: "dracula",
    });
    expect(isDraftDirty(APPLIED, enabled)).toBe(true);

    const disabled = setDraftCustomized(enabled, "codigo", false, PRESETS, "light");
    expect(disabled.blocks.codigo).toBe(false);
    expect(disabled.stored.shiki).toBeNull();
    expect(isDraftDirty(APPLIED, disabled)).toBe(false);
  });

  it("restores the presets while keeping the customization flag", () => {
    let draft = setDraftCustomized(APPLIED, "fonte", true, PRESETS, "light");
    draft = setDraftFont(draft, {
      family: "Inter",
      stack: '"Inter", sans-serif',
      source: "local",
    });
    const restored = restoreDraftBlock(draft, "fonte", PRESETS, "light");
    expect(restored.blocks.fonte).toBe(true);
    expect(restored.stored.font).toEqual({
      family: "system-ui",
      stack: "system-ui, sans-serif",
      source: "local",
    });
  });

  it("switching the chart example never makes the draft dirty", () => {
    const draft = setDraftExample(APPLIED, "classes");
    expect(draft.exampleId).toBe("classes");
    // The example is a live view preference, not a setting to save.
    expect(isDraftDirty(APPLIED, draft)).toBe(false);
    expect(needsReload(APPLIED, draft, DATA)).toBe(false);
    expect(commitSnapshot(APPLIED, draft).exampleId).toBe("classes");
  });

  it("keeps table wrap in the draft until commit and does not reload", () => {
    const draft = setDraftTableWrap(APPLIED, true);
    expect(draft.tableWrap).toBe(true);
    expect(APPLIED.tableWrap).toBe(false);
    expect(isDraftDirty(APPLIED, draft)).toBe(true);
    expect(needsReload(APPLIED, draft, DATA)).toBe(false);

    expect(commitSnapshot(APPLIED, draft).tableWrap).toBe(true);
    expect(discardSnapshot(APPLIED).tableWrap).toBe(false);
  });

  it("only reloads for theme, Shiki or Mermaid changes", () => {
    expect(needsReload(APPLIED, setDraftZoom(APPLIED, 1.4), DATA)).toBe(false);
    expect(
      needsReload(
        APPLIED,
        setDraftFont(setDraftSimpleTables(APPLIED, true), {
          family: "Inter",
          stack: '"Inter", sans-serif',
          source: "local",
        }),
        DATA
      )
    ).toBe(false);

    const theme = setDraftTheme(APPLIED, "nord", "dark");
    expect(needsReload(APPLIED, theme, DATA)).toBe(true);

    let shiki = setDraftCustomized(APPLIED, "codigo", true, PRESETS, "light");
    shiki = {
      ...shiki,
      stored: { ...shiki.stored, shiki: { light: "dracula", dark: "dracula" } },
    };
    expect(needsReload(APPLIED, shiki, DATA)).toBe(true);

    let mermaid = setDraftCustomized(APPLIED, "graficos", true, PRESETS, "light");
    mermaid = {
      ...mermaid,
      stored: { ...mermaid.stored, mermaid: { light: "neutral", dark: "neutral" } },
    };
    expect(needsReload(APPLIED, mermaid, DATA)).toBe(true);
  });

  it("resolves previews from the draft, not from the applied state", () => {
    const applied = effectiveBlocks(DATA, APPLIED);
    expect(applied?.fonte.value.family).toBe("system-ui");
    expect(applied?.loader.value).toBe("classic");

    let draft = setDraftTheme(APPLIED, "nord", "dark");
    draft = setDraftCustomized(draft, "loader", true, NORD.presets, "dark");
    const preview = effectiveBlocks(DATA, draft);
    expect(preview?.loader.customized).toBe(true);
    expect(preview?.loader.value).toBe("ring");
    expect(preview?.codigo.value).toEqual({ light: "nord", dark: "nord" });
  });

  it("lists the table wrap key in the Sistema reset", () => {
    const source = readFileSync(
      join(import.meta.dir, "../src/ui/islands/settings/pages/sistema.ts"),
      "utf8"
    );
    expect(source).toContain('"mdprv_table_wrap"');
  });
});
