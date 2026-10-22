import { describe, expect, it } from "bun:test";

import {
  DEFAULT_FONT_STACK,
  fontStack,
  MAX_FAMILY_LENGTH,
  normalizeFonts,
  parseFcList,
  sanitizeFamily,
} from "../src/core/fonts";

describe("sanitizeFamily", () => {
  it("trims and collapses whitespace", () => {
    expect(sanitizeFamily("  Inter   Display  ")).toBe("Inter Display");
  });

  it("keeps accented family names", () => {
    expect(sanitizeFamily("Ação")).toBe("Ação");
  });

  it("rejects empty names and forbidden characters", () => {
    for (const value of [
      "",
      "   ",
      "Bad;Family",
      "Bad{Family}",
      "Bad}Family",
      "Bad<Family>",
      'Bad"Family',
      "Bad'Family",
      "Bad\\Family",
      "Bad\tFamily",
      "Bad\nFamily",
    ]) {
      expect(sanitizeFamily(value)).toBeNull();
    }
  });

  it("enforces the 128 character limit", () => {
    expect(sanitizeFamily("a".repeat(MAX_FAMILY_LENGTH))).toBe("a".repeat(MAX_FAMILY_LENGTH));
    expect(sanitizeFamily("a".repeat(MAX_FAMILY_LENGTH + 1))).toBeNull();
  });
});

describe("fontStack", () => {
  it("quotes the requested family and appends the default fallback", () => {
    expect(fontStack("Inter")).toBe(`"Inter", ${DEFAULT_FONT_STACK}`);
  });

  it("does not quote generic families and avoids duplicating them", () => {
    const stack = fontStack("monospace");
    expect(stack.startsWith("monospace, ")).toBe(true);
    expect(stack).not.toContain('"monospace"');
    expect(fontStack("system-ui").match(/system-ui/g)).toHaveLength(1);
  });

  it("falls back to the default stack for missing or invalid families", () => {
    expect(fontStack(null)).toBe(DEFAULT_FONT_STACK);
    expect(fontStack("")).toBe(DEFAULT_FONT_STACK);
    expect(fontStack("Bad;Family")).toBe(DEFAULT_FONT_STACK);
  });
});

describe("parseFcList", () => {
  it("parses CRLF output, composite families and empty fields", () => {
    const text = [
      "Noto Sans,DejaVu Sans\tBold\t100\r",
      "Ação\tRegular\t0",
      "  \t\t",
      "invalid line",
      "Fira Code\t\t110",
    ].join("\n");

    expect(parseFcList(text)).toEqual([
      { family: "Noto Sans", style: "Bold", spacing: 100 },
      { family: "DejaVu Sans", style: "Bold", spacing: 100 },
      { family: "Ação", style: "Regular", spacing: 0 },
      { family: "Fira Code", style: "", spacing: 110 },
    ]);
  });

  it("ignores malformed spacing and empty family fragments", () => {
    const records = parseFcList("Mystery\tRegular\tnot-a-number\n, \tItalic\t\n");
    expect(records).toEqual([{ family: "Mystery", style: "Regular", spacing: null }]);
  });

  it("returns an empty list for empty input", () => {
    expect(parseFcList("")).toEqual([]);
  });
});

describe("normalizeFonts", () => {
  it("dedupes families and styles case-insensitively and sorts them", () => {
    const fonts = normalizeFonts([
      { family: "DejaVu Sans", style: "Bold", spacing: 0 },
      { family: "dejavu sans", style: "Regular", spacing: 0 },
      { family: "DejaVu Sans", style: "bold", spacing: null },
      { family: "Ação", style: "Italic", spacing: null },
      { family: "JetBrains Mono", style: "Regular", spacing: 100 },
      { family: "DejaVu Serif", style: "Book", spacing: 0 },
      { family: "Noto Sans", style: "Regular", spacing: 0 },
      { family: "Dancing Script", style: "Regular", spacing: 0 },
      { family: "Mystery", style: "Regular", spacing: 0 },
    ]);

    expect(fonts.map((font) => font.family)).toEqual([
      "Ação",
      "Dancing Script",
      "DejaVu Sans",
      "DejaVu Serif",
      "JetBrains Mono",
      "Mystery",
      "Noto Sans",
    ]);

    const dejavu = fonts.find((font) => font.family === "DejaVu Sans");
    expect(dejavu?.styles).toEqual(["Bold", "Regular"]);
    expect(fonts.find((font) => font.family === "Ação")?.styles).toEqual(["Italic"]);
  });

  it("categorizes monospace by spacing and by name heuristics", () => {
    const fonts = normalizeFonts([
      { family: "DejaVu Sans", style: "Regular", spacing: 0 },
      { family: "DejaVu Serif", style: "Regular", spacing: 0 },
      { family: "Noto Sans", style: "Regular", spacing: 0 },
      { family: "Dancing Script", style: "Regular", spacing: 0 },
      { family: "JetBrains Mono", style: "Regular", spacing: 0 },
      { family: "Weird", style: "Regular", spacing: 110 },
      { family: "Mystery", style: "Regular", spacing: 0 },
    ]);

    const category = (family: string) =>
      fonts.find((font) => font.family === family)?.category;

    expect(category("DejaVu Sans")).toBe("sans");
    expect(category("DejaVu Serif")).toBe("serif");
    expect(category("Noto Sans")).toBe("sans");
    expect(category("Dancing Script")).toBe("script");
    expect(category("JetBrains Mono")).toBe("monospace");
    expect(category("Weird")).toBe("monospace");
    expect(category("Mystery")).toBe("unknown");
  });

  it("returns an empty list when there are no valid records", () => {
    expect(normalizeFonts([])).toEqual([]);
    expect(normalizeFonts([{ family: "Bad;Family", style: "Regular", spacing: 0 }])).toEqual([]);
  });
});
