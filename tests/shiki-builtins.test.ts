import { describe, expect, it } from "bun:test";
import { themeNames } from "@shikijs/themes";

import {
  BUILTIN_SHIKI_THEMES,
  BUILTIN_SHIKI_THEME_NAMES,
} from "../src/core/markdown/shiki-builtins";
import {
  SHIKI_THEME_ID_RE,
  SHIKI_THEME_NAMES,
} from "../src/core/themes/constants";

function luminance(color: string | undefined): number | null {
  if (!color) {
    return null;
  }
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return null;
  }
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

describe("builtin Shiki catalog", () => {
  it("matches the package names, order and length", () => {
    expect(BUILTIN_SHIKI_THEMES.map((theme) => theme.name) as string[]).toEqual([
      ...themeNames,
    ] as string[]);
    expect([...SHIKI_THEME_NAMES] as string[]).toEqual([...themeNames] as string[]);
    expect(SHIKI_THEME_NAMES).toHaveLength(65);
  });

  it("uses valid slugs and exposes every name in the set", () => {
    for (const theme of BUILTIN_SHIKI_THEMES) {
      expect(SHIKI_THEME_ID_RE.test(theme.name)).toBe(true);
      expect(BUILTIN_SHIKI_THEME_NAMES.has(theme.name)).toBe(true);
    }
    expect(BUILTIN_SHIKI_THEME_NAMES.size).toBe(BUILTIN_SHIKI_THEMES.length);
  });

  it("declares a polarity that matches the module type or background", async () => {
    for (const theme of BUILTIN_SHIKI_THEMES) {
      const module = await theme.load();
      if (module.type === "light" || module.type === "dark") {
        expect(theme.kind).toBe(module.type);
        continue;
      }
      const bg = module.colors?.["editor.background"] ?? module.colors?.bg;
      const value = luminance(bg);
      expect(value).not.toBeNull();
      expect(theme.kind).toBe((value as number) < 0.5 ? "dark" : "light");
    }
  }, 30000);

  it("includes representative themes across the catalog", () => {
    expect(SHIKI_THEME_NAMES).toContain("tokyo-night");
    expect(SHIKI_THEME_NAMES).toContain("catppuccin-mocha");
    expect(SHIKI_THEME_NAMES).toContain("rose-pine-dawn");
    expect(SHIKI_THEME_NAMES).toContain("gruvbox-dark-medium");
  });
});
