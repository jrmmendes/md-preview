import { describe, expect, it } from "bun:test";

import { ICON_KEYS } from "../src/core/icons/constants";
import { IconPackError, validateIconPack } from "../src/core/icons/validate";

function pack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "custom",
    icons: { copy: "custom/copy.svg" },
    ...overrides,
  };
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (err) {
    return err instanceof IconPackError ? err.code : "other";
  }
}

describe("icon pack schema", () => {
  it("accepts a minimal pack and defaults to symbolic", () => {
    const valid = validateIconPack("custom", pack());
    expect(valid.name).toBe("custom");
    expect(valid.style).toBe("symbolic");
    expect(valid.icons.copy).toBe("custom/copy.svg");
    expect(valid.id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("accepts every closed icon key", () => {
    const icons: Record<string, string> = {};
    for (const key of ICON_KEYS) {
      icons[key] = `custom/${key}.svg`;
    }
    const valid = validateIconPack("custom", pack({ icons }));
    expect(Object.keys(valid.icons)).toHaveLength(ICON_KEYS.length);
  });

  it("rejects unknown icon keys with an invalid error", () => {
    expect(codeOf(() => validateIconPack("custom", pack({ icons: { nope: "custom/nope.svg" } })))).toBe(
      "invalid"
    );
  });

  it("rejects unsafe asset paths", () => {
    for (const value of [
      "../secret.svg",
      "/etc/passwd.svg",
      "custom/../secret.svg",
      "custom/COPy.svg",
      "custom/copy.png",
      "https://example.test/copy.svg",
    ]) {
      expect(codeOf(() => validateIconPack("custom", pack({ icons: { copy: value } })))).toBe(
        "invalid"
      );
    }
  });

  it("caps decoded data URIs at 32 KiB", () => {
    const small = `data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}`;
    expect(validateIconPack("custom", pack({ icons: { copy: small } })).icons.copy).toBe(small);

    const huge = `data:image/svg+xml;base64,${Buffer.alloc(33 * 1024).toString("base64")}`;
    expect(codeOf(() => validateIconPack("custom", pack({ icons: { copy: huge } })))).toBe(
      "too-large"
    );
  });

  it("validates the file name, schema version and style", () => {
    expect(codeOf(() => validateIconPack("custom", pack({ name: "other" })))).toBe("invalid");
    expect(codeOf(() => validateIconPack("Custom", pack()))).toBe("invalid");
    expect(codeOf(() => validateIconPack("custom", pack({ schemaVersion: 2 })))).toBe("invalid");
    expect(codeOf(() => validateIconPack("custom", pack({ style: "color" })))).toBe("invalid");
    expect(codeOf(() => validateIconPack("custom", pack({ icons: {} })))).toBe("invalid");
  });

  it("rejects unknown root keys so typos do not pass silently", () => {
    expect(codeOf(() => validateIconPack("custom", pack({ colour: "red" })))).toBe("invalid");
  });
});
