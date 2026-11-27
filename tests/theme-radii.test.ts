import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { themeCss, tokenCss } from "../src/core/themes/css";
import { getTheme, type FixedTheme, type ThemeRadii } from "../src/core/themes/tokens";

const STYLES = join(import.meta.dir, "../src/ui/styles");

function styleSheet(name: string): string {
  return readFileSync(join(STYLES, name), "utf8");
}

/** `border-radius` value of the rule whose selector list contains `selector`. */
function radiusDeclaration(source: string, selector: string): string {
  const wanted = selector.replace(/\s+/g, "").replace(/\{$/, "");
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of clean.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selectors = rule[1].split(",").map((part) => part.replace(/\s+/g, "").trim());
    if (!selectors.includes(wanted)) {
      continue;
    }
    const match = /border-radius:([^;}]+)/.exec(rule[2]);
    if (match) {
      return match[1].trim();
    }
  }
  throw new Error(`missing border-radius in ${selector}`);
}

/** Token name of every `var(--mdprv-radius-*)` reference in a declaration. */
function radiusTokens(declaration: string): string[] {
  return [...declaration.matchAll(/var\(--mdprv-radius-([a-z]+),\s*\d+px\)/g)].map(
    (match) => match[1]
  );
}

/** True when the value carries a px radius outside the var() fallbacks. */
function hasLiteralRadiusPx(declaration: string): boolean {
  const withoutVars = declaration.replace(/var\([^)]*\)/g, "");
  return /\b\d+(?:\.\d+)?px\b/.test(withoutVars);
}

function radii(overrides: Partial<ThemeRadii> = {}): ThemeRadii {
  return { none: 0, sm: 4, md: 5, lg: 8, xl: 12, pill: 999, circle: 9999, ...overrides };
}

/** Copy of a fixed theme with a different radius scale. */
function withRadii(theme: FixedTheme, overrides: Partial<ThemeRadii>): FixedTheme {
  return { ...theme, radii: { ...theme.radii, ...overrides } };
}

/** Evaluates the guarded `max(0px, calc(<radius> - 1px))` subtraction. */
function guardValue(declaration: string, radius: number): number {
  const match = /^max\(0px,calc\(var\(--mdprv-radius-md, 6px\) - 1px\)\)$/.exec(declaration);
  if (!match) {
    throw new Error(`unexpected guard ${declaration}`);
  }
  return Math.max(0, radius - 1);
}

describe("breeze radii tokens", () => {
  it("emits the near-square Plasma scale for breeze-dark", () => {
    const css = themeCss(getTheme("breeze-dark"));
    expect(css).toContain("--mdprv-radius-none:0px");
    expect(css).toContain("--mdprv-radius-sm:0px");
    expect(css).toContain("--mdprv-radius-md:2px");
    expect(css).toContain("--mdprv-radius-lg:3px");
    expect(css).toContain("--mdprv-radius-xl:4px");
  });

  it("emits the same scale for breeze-light and the auto pair", () => {
    expect(themeCss(getTheme("breeze-light"))).toContain("--mdprv-radius-md:2px");
    const auto = themeCss(getTheme("breeze"));
    expect(auto).toContain("--mdprv-radius-md:2px");
    expect(auto).toContain('html[data-scheme="dark"]{');
  });

  it("keeps sm flat and md barely rounded in both fixed Breeze themes", () => {
    for (const name of ["breeze-light", "breeze-dark"]) {
      const theme = getTheme(name).light;
      expect({ name, sm: theme.radii.sm, md: theme.radii.md }).toEqual({
        name,
        sm: 0,
        md: 2,
      });
    }
  });

  it("keeps the default scale for themes that do not declare one", () => {
    expect(themeCss(getTheme("nord"))).toContain("--mdprv-radius-md:6px");
    expect(themeCss(getTheme("nord"))).not.toContain("--mdprv-radius-md:2px");
  });
});

describe("radius consumers", () => {
  const table = styleSheet("table.css");
  const settings = styleSheet("settings.css");
  const raw = styleSheet("raw.css");
  const tree = styleSheet("tree.css");

  const consumers: Array<[string, string, string]> = [
    ["table.css", table, ".mdprv-table-fcount"],
    ["table.css", table, ".mdprv-chart-swatch"],
    ["table.css", table, ".mdprv-table-handle::after"],
    ["table.css", table, '.mdprv-table-handle[data-lb-handle="se"]::after'],
    ["table.css", table, ".mdprv-table {"],
    ["table.css", table, ".mdprv-table-lightbox .mdprv-table"],
    ["settings.css", settings, ".mdprv-settings-nav-item.is-active::before"],
    ["settings.css", settings, ".mdprv-settings-nav-child.is-active::before"],
    ["settings.css", settings, ".mdprv-settings-theme-swatch-title"],
    ["settings.css", settings, ".mdprv-settings-theme-swatch-text"],
    ["settings.css", settings, ".mdprv-settings-icon-pack-badge"],
    ["raw.css", raw, ".mdprv-raw-pre"],
    ["raw.css", raw, ".mdprv-raw-code"],
    ["tree.css", tree, ".mdprv-tree-raw pre"],
  ];

  it("never hardcodes a px radius in the corrected selectors", () => {
    for (const [file, source, selector] of consumers) {
      const declaration = radiusDeclaration(source, selector);
      expect({
        file,
        selector,
        token: /var\(--mdprv-radius-[a-z]+,\s*\d+px\)/.test(declaration),
      }).toEqual({ file, selector, token: true });
      expect({ file, selector, literal: hasLiteralRadiusPx(declaration) }).toEqual({
        file,
        selector,
        literal: false,
      });
    }
  });

  it("uses the none token for inner resets and the xl token for the modal", () => {
    const all = [table, settings, raw, tree].join("\n");
    expect(all).toContain("var(--mdprv-radius-none, 0px)");
    expect(all).toContain("var(--mdprv-radius-xl, 12px)");
    expect(radiusDeclaration(table, ".mdprv-table-lightbox .mdprv-table")).toBe(
      "var(--mdprv-radius-xl, 12px)"
    );
    expect(radiusDeclaration(settings, ".mdprv-settings-code-host pre.shiki")).toBe(
      "var(--mdprv-radius-none, 0px)"
    );
  });

  it("binds every consumer to the token that the theme declares", () => {
    const theme = getTheme("breeze-dark").light;
    for (const [, source, selector] of consumers) {
      const tokens = radiusTokens(radiusDeclaration(source, selector));
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) {
        expect(token in theme.radii).toBe(true);
      }
    }

    const narrow = withRadii(theme, { sm: 2, md: 0, lg: 1, xl: 20 });
    expect(tokenCss(narrow)).toContain("--mdprv-radius-md:0px");
    expect(tokenCss(narrow)).toContain("--mdprv-radius-xl:20px");
    expect(tokenCss(narrow)).not.toBe(tokenCss(theme));
    expect(tokenCss(withRadii(theme, theme.radii))).toBe(tokenCss(theme));
  });

  it("guards the inset radius against md = 0", () => {
    for (const selector of [
      ".mdprv-settings-emoji-pack-select",
      ".mdprv-settings-icon-pack-select",
    ]) {
      const declaration = radiusDeclaration(settings, selector);
      expect(declaration).toBe("max(0px,calc(var(--mdprv-radius-md, 6px) - 1px))");
      expect(guardValue(declaration, 0)).toBe(0);
      expect(guardValue(declaration, 5)).toBe(4);
      expect(guardValue(declaration, 1)).toBe(0);
    }
  });
});
