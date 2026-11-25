import { describe, expect, it } from "bun:test";

import { renderMarkdown } from "../src/core/markdown/render";
import { mermaidPayload } from "../src/core/themes/mermaid";
import { applyThemeOverrides } from "../src/core/themes/overrides";
import { getTheme } from "../src/core/themes/tokens";
import type { ThemePrefs } from "../src/shared/theme-prefs";

const PREFS: ThemePrefs = {
  v: 1,
  shiki: { light: "solarized-light", dark: "dracula" },
  mermaid: { light: "forest", dark: "dark" },
};

describe("applyThemeOverrides", () => {
  it("returns the same theme when there are no preferences", () => {
    const theme = getTheme("auto");
    expect(applyThemeOverrides(theme, null)).toBe(theme);
    expect(applyThemeOverrides(theme, { v: 1 })).toBe(theme);
  });

  it("clones the resolved theme without mutating the store", () => {
    const theme = getTheme("auto");
    const originalLight = theme.light;
    const originalDark = theme.dark;
    const result = applyThemeOverrides(theme, PREFS);
    expect(result).not.toBe(theme);
    expect(result.light).not.toBe(originalLight);
    expect(result.dark).not.toBe(originalDark);
    // The store copy is untouched.
    expect(getTheme("auto").light).toBe(originalLight);
    expect(originalLight.shiki.light).toBe("github-light");
    expect(originalDark.shiki.dark).toBe("github-dark");
  });

  it("applies one Shiki pair and one Mermaid theme per effective scheme", () => {
    const result = applyThemeOverrides(getTheme("auto"), PREFS);
    expect(result.light.shiki).toEqual({ light: "solarized-light", dark: "dracula" });
    expect(result.dark.shiki).toEqual({ light: "solarized-light", dark: "dracula" });
    expect(result.light.mermaid.theme).toBe("forest");
    expect(result.dark.mermaid.theme).toBe("dark");
  });

  it("falls back per slot when an override names a missing custom theme", () => {
    const result = applyThemeOverrides(getTheme("auto"), {
      v: 1,
      shiki: { light: "tema-ausente", dark: "dracula" },
    });
    expect(result.light.shiki).toEqual({ light: "github-light", dark: "dracula" });
  });

  it("keeps the theme Mermaid overrides and colors", () => {    const theme = getTheme("nord");
    const result = applyThemeOverrides(theme, { v: 1, mermaid: { light: "base", dark: "base" } });
    expect(result.light.mermaid.overrides).toEqual(theme.light.mermaid.overrides);
    expect(result.light.colors).toEqual(theme.light.colors);
    // Fixed dark theme uses its own scheme side.
    expect(result.light.mermaid.theme).toBe("base");
    expect(result.dark.mermaid.theme).toBe("base");
  });

  it("uses the dark side for a fixed light theme only when it is the matching kind", () => {
    const light = applyThemeOverrides(getTheme("github-light"), {
      v: 1,
      mermaid: { light: "neutral", dark: "dark" },
    });
    expect(light.light.mermaid.theme).toBe("neutral");
    const dark = applyThemeOverrides(getTheme("dracula"), {
      v: 1,
      mermaid: { light: "neutral", dark: "dark" },
    });
    expect(dark.dark.mermaid.theme).toBe("dark");
  });

  it("feeds the override into mermaidPayload", () => {
    const payload = mermaidPayload(applyThemeOverrides(getTheme("auto"), PREFS));
    expect(payload.light.theme).toBe("forest");
    expect(payload.dark.theme).toBe("dark");
    expect(payload.light.themeVariables).toEqual(
      mermaidPayload(getTheme("auto")).light.themeVariables
    );
  });
});

describe("renderer cache", () => {
  const fence = "```ts\nconst answer: number = 42;\n```\n";

  it("separates renderers by Shiki pair so overrides do not leak", async () => {
    const a = await renderMarkdown(fence, "auto", "doc", {
      themeOverrides: { v: 1, shiki: { light: "solarized-light", dark: "dracula" } },
    });
    const b = await renderMarkdown(fence, "auto", "doc", {
      themeOverrides: { v: 1, shiki: { light: "nord", dark: "nord" } },
    });
    const aAgain = await renderMarkdown(fence, "auto", "doc", {
      themeOverrides: { v: 1, shiki: { light: "solarized-light", dark: "dracula" } },
    });
    const plain = await renderMarkdown(fence, "auto", "doc");

    expect(a).toContain("--shiki-dark");
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
    expect(plain).not.toBe(a);
    expect(plain).not.toBe(b);
  });
});
