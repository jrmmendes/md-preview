import { describe, expect, it } from "bun:test";

import {
  buildThemeImportPayload,
  deriveThemeName,
  themeSlugFromFile,
} from "../src/ui/islands/settings/previews/theme-import";
import {
  deriveShikiName,
  shikiImportError,
  shikiSlugFromFile,
} from "../src/ui/islands/settings/previews/shiki-import";
import {
  buildMermaidImportPayload,
  deriveMermaidName,
  mermaidSlugFromFile,
} from "../src/ui/islands/settings/previews/mermaid-import";

describe("settings import helpers", () => {
  it("derives the color theme slug from the JSON name and file", () => {
    expect(deriveThemeName({ name: "Meu Tema" })).toBe("meu-tema");
    expect(themeSlugFromFile("Meu Tema.json")).toBe("meu-tema");
    const payload = buildThemeImportPayload(
      JSON.stringify({ name: "Meu Tema", colors: {} }),
      "Meu Tema"
    );
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.value.name).toBe("meu-tema");
    }
  });

  it("requires a name and valid JSON for the color theme", () => {
    expect(buildThemeImportPayload("", "x")).toEqual({
      ok: false,
      error: "Cole um theme.json ou selecione um arquivo.",
    });
    expect(buildThemeImportPayload("{", "x").ok).toBe(false);
    expect(buildThemeImportPayload("{}", "  ").ok).toBe(false);
  });

  it("strips the .shiki.json suffix from the file-derived name", () => {
    expect(shikiSlugFromFile("solarized-dark.shiki.json")).toBe("solarized-dark");
    expect(deriveShikiName({ theme: { displayName: "Minha Paleta" } })).toBe(
      "minha-paleta"
    );
    expect(shikiImportError(409, "")).toContain("Já existe");
  });

  it("normalizes the Mermaid payload with schemaVersion and slug", () => {
    expect(deriveMermaidName({ name: "Meu Diagrama" })).toBe("meu-diagrama");
    expect(mermaidSlugFromFile("meu-diagrama.mermaid.json")).toBe("meu-diagrama");
    const payload = buildMermaidImportPayload(
      JSON.stringify({ name: "Meu Diagrama", variables: { primaryColor: "#d97757" } }),
      "Meu Diagrama"
    );
    expect(payload.ok).toBe(true);
    if (payload.ok) {
      expect(payload.value.schemaVersion).toBe(1);
      expect(payload.value.name).toBe("meu-diagrama");
    }
  });
});
