import { describe, expect, it } from "bun:test";

import { getTheme } from "../src/core/themes/index";
import {
  mermaidConfig,
  resetMermaidWarnings,
} from "../src/core/themes/mermaid";
import type { FixedTheme } from "../src/core/themes/types";
import {
  buildImportPayload,
  COLOR_THEME_GUARD_MESSAGE,
  isColorThemeJson,
} from "../src/shared/shiki-import-payload";

function fixed(): FixedTheme {
  return getTheme("github-light").light;
}

describe("custom Mermaid resolution", () => {
  it("uses the imported base theme and variables", () => {
    resetMermaidWarnings();
    const theme: FixedTheme = {
      ...fixed(),
      mermaid: { theme: "meu-diagrama", overrides: {} },
    };
    const warnings: string[] = [];
    const config = mermaidConfig(theme, {
      getCustom: (name) =>
        name === "meu-diagrama"
          ? {
              name,
              theme: "neutral",
              variables: { primaryColor: "#d97757", lineColor: "#a14a2e" },
              sha: "00000000",
            }
          : undefined,
      warn: (message) => warnings.push(message),
    });
    expect(config).toEqual({
      theme: "neutral",
      themeVariables: { primaryColor: "#d97757", lineColor: "#a14a2e" },
    });
    expect(warnings).toEqual([]);
  });

  it("falls back to the builtin default and warns once", () => {
    resetMermaidWarnings();
    const theme: FixedTheme = {
      ...fixed(),
      mermaid: { theme: "sumiu", overrides: { primaryColor: "#123456" } },
    };
    const warnings: string[] = [];
    const deps = {
      getCustom: () => undefined,
      warn: (message: string) => warnings.push(message),
    };
    const first = mermaidConfig(theme, deps);
    const second = mermaidConfig(theme, deps);
    expect(first.theme).toBe("default");
    expect(first.themeVariables.primaryColor).toBe("#123456");
    expect(second.theme).toBe("default");
    expect(warnings).toHaveLength(1);
  });
});

describe("Shiki importer color-theme guard", () => {
  const colorTheme = JSON.stringify({
    $schema: "./theme.schema.json",
    schemaVersion: 1,
    name: "tropical",
    kind: "light",
    colors: { background: "#f0eee6", text: "#191919", accent: "#d97757" },
    shiki: { light: "github-light", dark: "github-light" },
    mermaid: { theme: "base", overrides: {} },
  });

  it("recognizes a full color theme before the Shiki wrapper", () => {
    expect(isColorThemeJson(JSON.parse(colorTheme))).toBe(true);
    const payload = buildImportPayload(colorTheme, "tropical");
    expect(payload.ok).toBe(false);
    if (!payload.ok) {
      expect(payload.error).toBe(COLOR_THEME_GUARD_MESSAGE);
      expect(payload.error).toContain("Temas → Importar");
    }
  });

  it("still wraps a bare VS Code/TextMate theme", () => {
    const payload = buildImportPayload(
      JSON.stringify({
        name: "minha-paleta",
        type: "dark",
        colors: { "editor.background": "#0b0e14" },
        tokenColors: [],
      }),
      "minha-paleta"
    );
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      const value = payload.value as {
        schemaVersion: number;
        name: string;
        theme: { colors: Record<string, string> };
      };
      expect(value.schemaVersion).toBe(1);
      expect(value.name).toBe("minha-paleta");
      expect(value.theme.colors["editor.background"]).toBe("#0b0e14");
    }
  });
});
