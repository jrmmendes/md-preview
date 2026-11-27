import { describe, expect, it } from "bun:test";

import {
  BUNDLED_EMOJI_PACKS,
  EMOJI_SCHEMA_JSON,
} from "../src/core/emoji/builtin";
import {
  EMOJI_SHORTCODE_RE,
  MAX_EMOJI_SHORTCODES,
  isEmojiStyle,
} from "../src/core/emoji/constants";
import {
  EmojiPackError,
  validateEmojiPack,
} from "../src/core/emoji/validate";

function pack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "custom",
    shortcodes: { smile: "😄", "+1": "👍", heart: "❤️" },
    ...overrides,
  };
}

function thrown(fn: () => unknown): EmojiPackError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(EmojiPackError);
    return err as EmojiPackError;
  }
  throw new Error("expected an EmojiPackError");
}

describe("emoji pack validation", () => {
  it("normalizes a minimal pack with the native default", () => {
    const value = validateEmojiPack("custom", pack());
    expect(value.schemaVersion).toBe(1);
    expect(value.name).toBe("custom");
    expect(value.style).toBe("native");
    expect(value.shortcodes).toEqual({ smile: "😄", "+1": "👍", heart: "❤️" });
    expect(value.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("keeps optional metadata and styles", () => {
    const value = validateEmojiPack(
      "custom",
      pack({
        label: "Custom",
        description: "Pacote de teste",
        style: "twemoji",
        license: "MIT",
        attribution: "Test",
      })
    );
    expect(value.label).toBe("Custom");
    expect(value.description).toBe("Pacote de teste");
    expect(value.style).toBe("twemoji");
    expect(value.license).toBe("MIT");
    expect(value.attribution).toBe("Test");
  });

  it("rejects a name mismatch, unknown keys and bad slugs", () => {
    expect(() => validateEmojiPack("other", pack())).toThrow(/name must equal the file name/);
    expect(() => validateEmojiPack("Bad Slug", pack())).toThrow(/file name/);
    expect(() => validateEmojiPack("custom", pack({ extra: true }))).toThrow(
      /unknown emoji pack key/
    );
    expect(() => validateEmojiPack("custom", pack({ schemaVersion: 2 }))).toThrow(
      /schemaVersion must be 1/
    );
    expect(() => validateEmojiPack("custom", pack({ style: "apple" }))).toThrow(
      /style must be/
    );
  });

  it("enforces the shortcode name and value rules", () => {
    expect(EMOJI_SHORTCODE_RE.test("x")).toBe(true);
    expect(EMOJI_SHORTCODE_RE.test("a")).toBe(false);
    expect(EMOJI_SHORTCODE_RE.test("+1")).toBe(true);
    expect(EMOJI_SHORTCODE_RE.test("white_check_mark")).toBe(true);
    expect(() =>
      validateEmojiPack("custom", pack({ shortcodes: { X: "😄" } }))
    ).toThrow(/shortcode name/);
    expect(() =>
      validateEmojiPack("custom", pack({ shortcodes: { smile: "abc" } }))
    ).toThrow(/non-emoji code point/);
    expect(() =>
      validateEmojiPack("custom", pack({ shortcodes: { digits: "12" } }))
    ).toThrow(/not an emoji sequence/);
    expect(() =>
      validateEmojiPack("custom", pack({ shortcodes: { long: "😀😀😀😀😀😀😀😀😀" } }))
    ).toThrow(/1 to 8 Unicode code points/);
    expect(() =>
      validateEmojiPack("custom", pack({ shortcodes: { svg: "data:image/png;base64,AAAA" } }))
    ).toThrow(/image\/svg\+xml/);
  });

  it("accepts ZWJ, skin tone and variation selector sequences", () => {
    const value = validateEmojiPack(
      "custom",
      pack({
        shortcodes: {
          family: "👨‍👩‍👧",
          wave_toned: "👋🏽",
          heart: "❤️",
          flag: "🇧🇷",
          keycap: "1️⃣",
        },
      })
    );
    expect(value.shortcodes.family).toBe("👨‍👩‍👧");
    expect(value.shortcodes.wave_toned).toBe("👋🏽");
    expect(value.shortcodes.flag).toBe("🇧🇷");
  });

  it("accepts a bounded SVG data URI and rejects oversized ones", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>`;
    const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const value = validateEmojiPack("custom", pack({ shortcodes: { svg: data } }));
    expect(value.shortcodes.svg).toBe(data);

    const big = Buffer.alloc(33 * 1024, 0x20).toString("base64");
    const err = thrown(() =>
      validateEmojiPack(
        "custom",
        pack({ shortcodes: { svg: `data:image/svg+xml;base64,${big}` } })
      )
    );
    expect(err.code).toBe("too-large");
  });

  it("caps the number of shortcodes", () => {
    const shortcodes: Record<string, string> = {};
    for (let i = 0; i <= MAX_EMOJI_SHORTCODES; i += 1) {
      shortcodes[`e${i}`] = "😀";
    }
    const err = thrown(() => validateEmojiPack("custom", pack({ shortcodes })));
    expect(err.code).toBe("too-many");
  });

  it("validates the bundled github pack and its limit", () => {
    const github = BUNDLED_EMOJI_PACKS.get("github");
    expect(github).toBeDefined();
    expect(github!.style).toBe("native");
    expect(Object.keys(github!.shortcodes).length).toBeGreaterThanOrEqual(80);
    expect(github!.shortcodes.rocket).toBe("🚀");
    expect(github!.shortcodes["+1"]).toBe("👍");
    expect(github!.shortcodes.x).toBe("❌");
    expect(github!.license).toBeDefined();
  });

  it("ships a JSON Schema matching the runtime contract", () => {
    const schema = EMOJI_SCHEMA_JSON as {
      properties?: Record<string, unknown>;
      required?: string[];
      additionalProperties?: unknown;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain("shortcodes");
    expect(schema.properties?.shortcodes).toBeDefined();
    expect(schema.properties?.style).toBeDefined();
    expect(isEmojiStyle("native")).toBe(true);
  });
});
