import { describe, expect, it } from "bun:test";

import { validateTheme, type FixedTheme } from "../src/core/themes/tokens";

const COLORS = {
  background: "#202020",
  surface: "#252525",
  text: "#eeeeee",
  muted: "#999999",
  border: "#333333",
  accent: "#88c0d0",
  "code-bg": "#2a2a2a",
  quote: "#999999",
};

function fixed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "sample",
    kind: "dark",
    colors: { ...COLORS },
    shiki: { light: "nord", dark: "nord" },
    mermaid: { theme: "neutral", overrides: {} },
    ...overrides,
  };
}

function auto(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "auto",
    kind: "auto",
    variants: { light: "sample", dark: "sample" },
    ...overrides,
  };
}

describe("validateTheme", () => {
  it("normalizes defaults and optional color aliases", () => {
    const theme = validateTheme("sample", fixed()) as FixedTheme;
    expect(theme.radii).toEqual({ none: 0, sm: 5, md: 6, lg: 8, xl: 12, pill: 999, circle: 9999 });
    expect(theme.typography["base-size"]).toBe(17);
    expect(theme.layout["content-width"]).toBe("46rem");
    expect(theme.effects["duration-fast"]).toBe(".15s");
    expect(theme.colors.link).toBe(COLORS.accent);
    expect(theme.colors["accent-fg"]).toBe(COLORS.background);
    expect(theme.colors["surface-raised"]).toBe(COLORS.surface);
  });

  it("accepts rgb, hsl and transparent colors", () => {
    const theme = validateTheme(
      "sample",
      fixed({
        colors: {
          ...COLORS,
          border: "rgb(1, 2, 3)",
          muted: "hsl(0, 0%, 50%)",
          quote: "transparent",
        },
      })
    ) as FixedTheme;
    expect(theme.colors.border).toBe("rgb(1, 2, 3)");
  });

  const invalid: Array<[string, Record<string, unknown>, string]> = [
    ["missing schemaVersion", fixed({ schemaVersion: undefined }), "sample"],
    ["schemaVersion 2", fixed({ schemaVersion: 2 }), "sample"],
    ["wrong name", fixed({ name: "other" }), "sample"],
    ["invalid kind", fixed({ kind: "sepia" }), "sample"],
    ["unknown top-level key", fixed({ extra: true }), "sample"],
    ["url color", fixed({ colors: { ...COLORS, background: "url(evil)" } }), "sample"],
    ["named color", fixed({ colors: { ...COLORS, background: "red" } }), "sample"],
    ["unsafe radius", fixed({ radii: { sm: 33 } }), "sample"],
    ["unsafe stack", fixed({ typography: { stack: "Inter;color:red" } }), "sample"],
    ["unsafe length", fixed({ layout: { "content-width": "calc(1px + 2px)" } }), "sample"],
    ["long duration", fixed({ effects: { "duration-fast": "3s" } }), "sample"],
    ["unknown shiki", fixed({ shiki: { light: "unknown", dark: "nord" } }), "sample"],
    [
      "unsafe mermaid key",
      fixed({ mermaid: { theme: "neutral", overrides: { "bad-key": "x" } } }),
      "sample",
    ],
    ["fixed with variants", fixed({ variants: { light: "sample", dark: "sample" } }), "sample"],
    ["auto with colors", auto({ colors: COLORS }), "auto"],
  ];
  for (const [label, raw, name] of invalid) {
    it(`rejects ${label}`, () => {
      expect(() => validateTheme(name, raw)).toThrow();
    });
  }

  it("accepts auto with only variants", () => {
    const theme = validateTheme("auto", auto());
    expect(theme.kind).toBe("auto");
  });
});
