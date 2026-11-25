import { describe, expect, it } from "bun:test";

import {
  MAX_SHIKI_COLORS,
  MAX_SHIKI_SCOPE_CHARS,
  MAX_SHIKI_TOKENS,
  ShikiThemeError,
  validateShikiCustom,
} from "../src/core/themes/shiki-custom";

function wrapper(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "minha-paleta",
    type: "dark",
    theme: {
      name: "minha-paleta",
      type: "dark",
      colors: {
        "editor.background": "#0b0e14",
        "editor.foreground": "#e6e6e6",
      },
      tokenColors: [
        {
          scope: ["source.ts", "source.tsx"],
          settings: { foreground: "#c0caf5", fontStyle: "italic" },
        },
      ],
    },
    ...overrides,
  };
}

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof ShikiThemeError) {
      return err.code;
    }
    throw err;
  }
  return "ok";
}

describe("validateShikiCustom", () => {
  it("accepts a valid wrapper and normalizes the registration", () => {
    const theme = validateShikiCustom(wrapper());
    expect(theme.name).toBe("minha-paleta");
    expect(theme.kind).toBe("dark");
    expect(theme.sha).toMatch(/^[0-9a-f]{8}$/);
    expect(theme.registration.name).toBe("minha-paleta");
    expect(theme.registration.type).toBe("dark");
    expect(theme.registration.colors?.["editor.background"]).toBe("#0b0e14");
    expect(theme.registration.tokenColors).toHaveLength(1);
  });

  it("is deterministic for the same content", () => {
    const a = validateShikiCustom(wrapper());
    const b = validateShikiCustom(wrapper());
    expect(a.sha).toBe(b.sha);
    const changed = wrapper();
    (changed.theme as Record<string, unknown>).colors = { bg: "#101010" };
    expect(validateShikiCustom(changed).sha).not.toBe(a.sha);
  });

  it("rejects a bare VS Code/TextMate theme on the server", () => {
    expect(code(() => validateShikiCustom({ name: "raw", colors: {} }))).toBe("invalid");
  });

  it("rejects reserved, builtin and mismatched names", () => {
    expect(code(() => validateShikiCustom(wrapper({ name: "auto" })))).toBe("exists");
    expect(code(() => validateShikiCustom(wrapper({ name: "nord" })))).toBe("exists");
    expect(code(() => validateShikiCustom(wrapper(), "outro"))).toBe("invalid");
    expect(code(() => validateShikiCustom(wrapper({ name: "Minha" })))).toBe("invalid");
  });

  it("rejects unknown wrapper keys and schema versions", () => {
    expect(code(() => validateShikiCustom(wrapper({ extra: true })))).toBe("invalid");
    expect(code(() => validateShikiCustom(wrapper({ schemaVersion: 2 })))).toBe("invalid");
  });

  it("rejects unsafe colors one by one", () => {
    const cases = ["url(evil)", "var(--x)", "", "<script>", "red"];
    for (const value of cases) {
      const raw = wrapper();
      (raw.theme as Record<string, unknown>).colors = { bg: value };
      expect(code(() => validateShikiCustom(raw))).toBe("invalid");
    }
  });

  it("enforces color and token limits", () => {
    const colors: Record<string, string> = {};
    for (let index = 0; index <= MAX_SHIKI_COLORS; index += 1) {
      colors[`color-${index}`] = "#000000";
    }
    expect(code(() => validateShikiCustom(wrapper({ theme: { colors } })))).toBe("too-many");
    const tokens = new Array(MAX_SHIKI_TOKENS + 1).fill({ settings: { foreground: "#fff" } });
    expect(code(() => validateShikiCustom(wrapper({ theme: { tokenColors: tokens } })))).toBe(
      "too-many"
    );
  });

  it("accepts real palettes larger than the old 512-color cap", () => {
    const colors: Record<string, string> = {};
    for (let index = 0; index < 564; index += 1) {
      colors[`color-${index}`] = "#101010";
    }
    const theme = validateShikiCustom(wrapper({ theme: { colors } }));
    expect(Object.keys(theme.registration.colors ?? {})).toHaveLength(564);
  });

  it("rejects long scopes and invalid font styles", () => {
    const longScope = wrapper();
    (longScope.theme as Record<string, unknown>).tokenColors = [
      { scope: "x".repeat(MAX_SHIKI_SCOPE_CHARS + 1) },
    ];
    expect(code(() => validateShikiCustom(longScope))).toBe("invalid");
    const badStyle = wrapper();
    (badStyle.theme as Record<string, unknown>).tokenColors = [
      { settings: { fontStyle: "ITALIC;" } },
    ];
    expect(code(() => validateShikiCustom(badStyle))).toBe("invalid");
  });

  it("infers polarity from the background when type is absent", () => {
    const light = validateShikiCustom({
      schemaVersion: 1,
      name: "claro",
      theme: { colors: { "editor.background": "#ffffff" } },
    });
    expect(light.kind).toBe("light");
    const dark = validateShikiCustom({
      schemaVersion: 1,
      name: "escuro",
      theme: { colors: { bg: "#101010" } },
    });
    expect(dark.kind).toBe("dark");
  });

  it("rejects a theme without type and without a recognizable background", () => {
    expect(
      code(() =>
        validateShikiCustom({
          schemaVersion: 1,
          name: "sem-tipo",
          theme: { tokenColors: [] },
        })
      )
    ).toBe("invalid");
  });

  it("validates semantic token colors", () => {
    const theme = validateShikiCustom(
      wrapper({
        theme: {
          colors: { bg: "#000000" },
          semanticTokenColors: {
            variable: "#111111",
            class: { foreground: "#222222", bold: true, italic: false },
          },
        },
      })
    );
    expect(theme.registration.semanticTokenColors as unknown).toEqual({
      variable: "#111111",
      class: { foreground: "#222222", bold: true, italic: false },
    });
    const raw = wrapper();
    (raw.theme as Record<string, unknown>).semanticTokenColors = { variable: "url(x)" };
    expect(code(() => validateShikiCustom(raw))).toBe("invalid");
  });
});
