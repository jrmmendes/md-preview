import { describe, expect, it } from "bun:test";

import { normalizeForSearch, searchFonts } from "../src/ui/services/font-search";

function names(fonts: { family: string }[]): string[] {
  return fonts.map((font) => font.family);
}

describe("normalizeForSearch", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeForSearch("  Ação ÁGIL  ")).toBe("acao agil");
  });
});

describe("searchFonts", () => {
  it("ranks exact, prefix, word prefix, substring and subsequence", () => {
    const fonts = [
      { family: "Ink Terrace" },
      { family: "Winter Sans" },
      { family: "Fira Inter" },
      { family: "Inter Tight" },
      { family: "Inter" },
    ];
    expect(names(searchFonts(fonts, "inter"))).toEqual([
      "Inter",
      "Inter Tight",
      "Fira Inter",
      "Winter Sans",
      "Ink Terrace",
    ]);
  });

  it("matches word prefixes independently of position", () => {
    const fonts = [{ family: "Mono Display" }, { family: "Display Sans" }, { family: "Display" }];
    expect(names(searchFonts(fonts, "display"))).toEqual([
      "Display",
      "Display Sans",
      "Mono Display",
    ]);
  });

  it("is diacritic and case insensitive", () => {
    const fonts = [{ family: "Ação" }, { family: "Inter" }];
    expect(names(searchFonts(fonts, "acao"))).toEqual(["Ação"]);
    expect(names(searchFonts(fonts, "INTER"))).toEqual(["Inter"]);
  });

  it("breaks ties with localeCompare", () => {
    const fonts = [{ family: "gamma" }, { family: "Alpha" }, { family: "Beta" }];
    expect(names(searchFonts(fonts, ""))).toEqual(["Alpha", "Beta", "gamma"]);
  });

  it("drops non-matching fonts and respects the limit", () => {
    const fonts = Array.from({ length: 100 }, (_, index) => ({ family: `Font ${index}` }));
    expect(searchFonts(fonts, "missing")).toEqual([]);
    expect(searchFonts(fonts, "", 80)).toHaveLength(80);
    expect(searchFonts(fonts, "", 0)).toEqual([]);
  });

  it("requires subsequence characters in order", () => {
    const fonts = [{ family: "Inter" }, { family: "Renit" }];
    expect(names(searchFonts(fonts, "itr"))).toEqual(["Inter"]);
  });
});
