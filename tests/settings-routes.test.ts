import { describe, expect, it } from "bun:test";

import {
  DEFAULT_ROUTE,
  parseSettingsRouteHash,
  parseSettingsRouteString,
  sameSettingsRoute,
  settingsRouteHash,
  settingsRouteString,
} from "../src/ui/islands/settings/routes";

describe("settings routes", () => {
  it("parses the canonical sections", () => {
    expect(parseSettingsRouteHash("#/temas")).toEqual({
      section: "temas",
      anchor: null,
    });
    expect(parseSettingsRouteHash("#/aparencia")).toEqual({
      section: "aparencia",
      anchor: null,
    });
    expect(parseSettingsRouteHash("#/sistema")).toEqual({ section: "sistema", anchor: null });
    expect(parseSettingsRouteHash("#/widgets")).toEqual({ section: "widgets", anchor: null });
    expect(parseSettingsRouteHash("#/emojis")).toEqual({ section: "emojis", anchor: null });
    expect(parseSettingsRouteHash("#/icons")).toEqual({ section: "icons", anchor: null });
  });

  it("parses the import subpage", () => {
    expect(parseSettingsRouteHash("#/temas/importar")).toEqual({
      section: "temas",
      anchor: "importar",
    });
    expect(parseSettingsRouteString("temas/importar")).toEqual({
      section: "temas",
      anchor: "importar",
    });
  });

  it("parses widget anchors", () => {
    for (const anchor of ["graficos", "tabelas", "diff"] as const) {
      expect(parseSettingsRouteHash(`#/widgets/${anchor}`)).toEqual({
        section: "widgets",
        anchor,
      });
    }
  });

  it("redirects legacy routes", () => {
    expect(parseSettingsRouteHash("#/codigo")).toEqual({
      section: "aparencia",
      anchor: null,
    });
    expect(parseSettingsRouteHash("#/graficos")).toEqual({
      section: "widgets",
      anchor: "graficos",
    });
    expect(parseSettingsRouteHash("#/tabelas")).toEqual({
      section: "widgets",
      anchor: "tabelas",
    });
    expect(parseSettingsRouteHash("#/diff")).toEqual({ section: "widgets", anchor: "diff" });
  });

  it("keeps the old Tema route pointing at the new Temas page", () => {
    expect(parseSettingsRouteHash("#/aparencia/tema")).toEqual({
      section: "temas",
      anchor: null,
    });
    expect(parseSettingsRouteString(" aparencia/tema ")).toEqual({
      section: "temas",
      anchor: null,
    });
  });

  it("rejects unknown, nested and non-anchor routes", () => {
    expect(parseSettingsRouteHash("")).toBeNull();
    expect(parseSettingsRouteHash("#")).toBeNull();
    expect(parseSettingsRouteHash("#/")).toBeNull();
    expect(parseSettingsRouteHash("#/aparencia/extra")).toBeNull();
    expect(parseSettingsRouteHash("#/sistema/codigo")).toBeNull();
    expect(parseSettingsRouteHash("#/emojis/importar")).toBeNull();
    expect(parseSettingsRouteHash("#/widgets/outro")).toBeNull();
    expect(parseSettingsRouteHash("#/temas/outro")).toBeNull();
    expect(parseSettingsRouteHash("#/temas/importar/extra")).toBeNull();
    expect(parseSettingsRouteHash("#/codigo/extra")).toBeNull();
    expect(parseSettingsRouteHash("#/desconhecida")).toBeNull();
    expect(parseSettingsRouteHash("aparencia")).toBeNull();
    expect(parseSettingsRouteString(null)).toBeNull();
    expect(parseSettingsRouteString("widgets/graficos/extra")).toBeNull();
  });

  it("reads the stored route body without the hash", () => {
    expect(parseSettingsRouteString("aparencia")).toEqual({
      section: "aparencia",
      anchor: null,
    });
    expect(parseSettingsRouteString("widgets/tabelas")).toEqual({
      section: "widgets",
      anchor: "tabelas",
    });
    expect(parseSettingsRouteString(" codigo ")).toEqual({
      section: "aparencia",
      anchor: null,
    });
    expect(parseSettingsRouteString("nope")).toBeNull();
  });

  it("round-trips route strings and hashes", () => {
    for (const route of [
      DEFAULT_ROUTE,
      { section: "temas", anchor: null },
      { section: "temas", anchor: "importar" },
      { section: "widgets", anchor: "diff" },
    ] as const) {
      expect(parseSettingsRouteHash(settingsRouteHash(route))).toEqual(route);
      expect(parseSettingsRouteString(settingsRouteString(route))).toEqual(route);
    }
    expect(settingsRouteHash(DEFAULT_ROUTE)).toBe("#/aparencia");
    expect(settingsRouteString({ section: "temas", anchor: "importar" })).toBe(
      "temas/importar"
    );
    expect(settingsRouteString({ section: "widgets", anchor: "graficos" })).toBe(
      "widgets/graficos"
    );
  });

  it("compares routes structurally", () => {
    expect(sameSettingsRoute(DEFAULT_ROUTE, { section: "aparencia", anchor: null })).toBe(true);
    expect(sameSettingsRoute(DEFAULT_ROUTE, { section: "sistema", anchor: null })).toBe(false);
    expect(
      sameSettingsRoute({ section: "widgets", anchor: "diff" }, { section: "widgets", anchor: null })
    ).toBe(false);
    expect(sameSettingsRoute(null, null)).toBe(true);
    expect(sameSettingsRoute(null, DEFAULT_ROUTE)).toBe(false);
  });
});
