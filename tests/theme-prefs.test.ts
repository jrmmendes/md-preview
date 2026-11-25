import { describe, expect, it } from "bun:test";

import {
  THEME_PREFS_MAX_BYTES,
  parseThemePrefs,
  serializeThemePrefs,
  type ThemePrefs,
} from "../src/shared/theme-prefs";

const VALID: ThemePrefs = {
  v: 1,
  shiki: { light: "solarized-light", dark: "dracula" },
  mermaid: { light: "forest", dark: "dark" },
};

describe("parseThemePrefs", () => {
  it("parses a full payload", () => {
    expect(parseThemePrefs(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("accepts a payload with only one group", () => {
    expect(parseThemePrefs(JSON.stringify({ v: 1, shiki: VALID.shiki }))).toEqual({
      v: 1,
      shiki: VALID.shiki,
    });
    expect(parseThemePrefs(JSON.stringify({ v: 1, mermaid: VALID.mermaid }))).toEqual({
      v: 1,
      mermaid: VALID.mermaid,
    });
  });

  it("treats null, empty and malformed JSON as no preferences", () => {
    expect(parseThemePrefs(null)).toBeNull();
    expect(parseThemePrefs("")).toBeNull();
    expect(parseThemePrefs("   ")).toBeNull();
    expect(parseThemePrefs("{not json")).toBeNull();
    expect(parseThemePrefs("[]")).toBeNull();
    expect(parseThemePrefs("null")).toBeNull();
  });

  it("rejects unknown versions and unknown top-level keys", () => {
    expect(parseThemePrefs(JSON.stringify({ v: 2, shiki: VALID.shiki }))).toBeNull();
    expect(parseThemePrefs(JSON.stringify({ shiki: VALID.shiki }))).toBeNull();
    expect(parseThemePrefs(JSON.stringify({ v: 1, extra: true }))).toBeNull();
    expect(parseThemePrefs(JSON.stringify({ v: 1, shiki: VALID.shiki, extra: 1 }))).toBeNull();
  });

  it("accepts builtin names and custom slugs, rejecting only invalid syntax", () => {
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, shiki: { light: "monokai", dark: "dracula" } }))
    ).toEqual({ v: 1, shiki: { light: "monokai", dark: "dracula" } });
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, shiki: { light: "minha-paleta", dark: "nord" } }))
    ).toEqual({ v: 1, shiki: { light: "minha-paleta", dark: "nord" } });
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, shiki: { light: "My Theme", dark: "nord" } }))
    ).toBeNull();
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, shiki: { light: "nord" } }))
    ).toBeNull();
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, shiki: { light: "nord", dark: "nord", x: 1 } }))
    ).toEqual({ v: 1, shiki: { light: "nord", dark: "nord" } });
  });

  it("drops the shiki group when a semantic predicate rejects a name", () => {
    const known = new Set(["nord", "minha-paleta"]);
    const options = { isShikiTheme: (name: string) => known.has(name) };
    expect(
      parseThemePrefs(
        JSON.stringify({ v: 1, shiki: { light: "minha-paleta", dark: "nord" } }),
        options
      )
    ).toEqual({ v: 1, shiki: { light: "minha-paleta", dark: "nord" } });
    expect(
      parseThemePrefs(
        JSON.stringify({ v: 1, shiki: { light: "nope", dark: "nord" } }),
        options
      )
    ).toBeNull();
  });

  it("accepts builtin and custom Mermaid slugs, rejecting invalid syntax", () => {
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, mermaid: { light: "candy", dark: "dark" } }))
    ).toEqual({ v: 1, mermaid: { light: "candy", dark: "dark" } });
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, mermaid: { light: "base", dark: "dark" } }))
    ).toEqual({ v: 1, mermaid: { light: "base", dark: "dark" } });
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, mermaid: { light: "Meu Tema", dark: "dark" } }))
    ).toBeNull();
    expect(
      parseThemePrefs(JSON.stringify({ v: 1, mermaid: { light: "base" } }))
    ).toBeNull();
  });

  it("drops the mermaid group when the server predicate rejects a name", () => {
    const known = new Set(["default", "dark", "meu-diagrama"]);
    const options = { isMermaidTheme: (name: string) => known.has(name) };
    expect(
      parseThemePrefs(
        JSON.stringify({ v: 1, mermaid: { light: "meu-diagrama", dark: "dark" } }),
        options
      )
    ).toEqual({ v: 1, mermaid: { light: "meu-diagrama", dark: "dark" } });
    expect(
      parseThemePrefs(
        JSON.stringify({ v: 1, mermaid: { light: "nao-existe", dark: "dark" } }),
        options
      )
    ).toBeNull();
  });

  it("discards cookies larger than the byte limit", () => {
    const big = `{"v":1,"shiki":{"light":"nord","dark":"nord"},"pad":"${"x".repeat(
      THEME_PREFS_MAX_BYTES
    )}"}`;
    expect(new TextEncoder().encode(big).length).toBeGreaterThan(THEME_PREFS_MAX_BYTES);
    expect(parseThemePrefs(big)).toBeNull();
  });
});

describe("serializeThemePrefs", () => {
  it("round-trips a valid payload", () => {
    const raw = serializeThemePrefs(VALID);
    expect(raw).not.toBeNull();
    expect(parseThemePrefs(raw)).toEqual(VALID);
  });

  it("returns null when there is nothing to carry", () => {
    expect(serializeThemePrefs(null)).toBeNull();
    expect(serializeThemePrefs({ v: 1 })).toBeNull();
  });

  it("drops unknown fields instead of writing them", () => {
    const raw = serializeThemePrefs({
      v: 1,
      shiki: { light: "nord", dark: "nord" },
      extra: true,
    } as unknown as ThemePrefs);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({ v: 1, shiki: { light: "nord", dark: "nord" } });
  });

  it("refuses invalid values", () => {
    expect(
      serializeThemePrefs({
        v: 1,
        shiki: { light: "Nope!", dark: "nord" },
      } as unknown as ThemePrefs)
    ).toBeNull();
  });
});
