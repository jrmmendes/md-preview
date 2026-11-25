import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLED_THEMES } from "../src/core/themes/builtin";
import { validateMermaidCustom } from "../src/core/themes/mermaid-custom";
import { validateShikiCustom } from "../src/core/themes/shiki-custom";
import { themeNames } from "../src/core/themes/tokens";
import { validateTheme } from "../src/core/themes/validate";

const DIR = join(import.meta.dir, "../themes/tropical");
const COLOR_FILES = ["tropical.json", "tropical-dark.json"] as const;
const SHIKI_FILES = ["tropical.shiki.json", "tropical-dark.shiki.json"] as const;
const MERMAID_FILES = ["tropical.mermaid.json", "tropical-dark.mermaid.json"] as const;

function read(file: string): unknown {
  return JSON.parse(readFileSync(join(DIR, file), "utf8"));
}

function slug(file: string, suffix: string): string {
  return file.slice(0, -suffix.length);
}

describe("themes/tropical collection", () => {
  it("ships exactly the six JSON files plus the README", () => {
    expect(existsSync(DIR)).toBe(true);
    expect(existsSync(join(DIR, "README.md"))).toBe(true);
    const files = readdirSync(DIR).sort();
    expect(files).toEqual(
      [...COLOR_FILES, ...SHIKI_FILES, ...MERMAID_FILES, "README.md"].sort()
    );
  });

  it("validates the light and dark color themes with the repository schema", () => {
    const light = validateTheme("tropical", read("tropical.json"));
    expect(light.name).toBe("tropical");
    expect(light.kind).toBe("light");

    const dark = validateTheme("tropical-dark", read("tropical-dark.json"));
    expect(dark.name).toBe("tropical-dark");
    expect(dark.kind).toBe("dark");

    for (const [file, theme] of [
      ["tropical.json", light],
      ["tropical-dark.json", dark],
    ] as const) {
      const raw = read(file) as Record<string, unknown>;
      // Inside the repo the schema is one level up, not next to the file.
      expect(raw.$schema).toBe("../theme.schema.json");
      if (theme.kind === "auto") {
        throw new Error("collection color themes must be fixed");
      }
      // Both slots point at the matching custom Shiki/Mermaid files.
      for (const slot of [theme.shiki.light, theme.shiki.dark]) {
        expect(existsSync(join(DIR, `${slot}.shiki.json`))).toBe(true);
      }
      expect(existsSync(join(DIR, `${theme.mermaid.theme}.mermaid.json`))).toBe(true);
      expect(Object.keys(theme.mermaid.overrides).length).toBeGreaterThan(0);
    }
  });

  it("validates both Shiki wrappers against their own file names", () => {
    for (const file of SHIKI_FILES) {
      const theme = validateShikiCustom(read(file), slug(file, ".shiki.json"));
      expect(theme.name).toBe(slug(file, ".shiki.json"));
      expect(theme.kind).toBe(file.includes("-dark") ? "dark" : "light");
    }
    expect(validateShikiCustom(read("tropical.shiki.json")).name).toBe("tropical");
  });

  it("validates both Mermaid wrappers against their own file names", () => {
    for (const file of MERMAID_FILES) {
      const theme = validateMermaidCustom(read(file), slug(file, ".mermaid.json"));
      expect(theme.name).toBe(slug(file, ".mermaid.json"));
      expect(theme.theme).toBe("base");
      expect(Object.keys(theme.variables).length).toBeGreaterThan(0);
    }
  });

  it("stays a collection and never becomes a builtin", () => {
    expect(BUNDLED_THEMES.has("tropical")).toBe(false);
    expect(BUNDLED_THEMES.has("tropical-dark")).toBe(false);
    expect(themeNames()).not.toContain("tropical");
    expect(themeNames()).not.toContain("tropical-dark");
  });
});
