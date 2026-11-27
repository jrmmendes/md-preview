import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seedThemes } from "../src/core/themes/seed";
import { validateTheme } from "../src/core/themes/validate";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-seed-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("seedThemes", () => {
  it("creates every builtin theme and the schema once", () => {
    const dir = join(tempDir(), "themes");
    const first = seedThemes({ dir });
    expect(first.created).toContain("auto");
    expect(first.created).toContain("nord");
    expect(first.created).toContain("theme.schema.json");
    expect(first.created).toContain("shiki-theme.schema.json");
    expect(first.created).toHaveLength(14);
    expect(existsSync(join(dir, "theme.schema.json"))).toBe(true);
    expect(existsSync(join(dir, "shiki-theme.schema.json"))).toBe(true);

    const second = seedThemes({ dir });
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThanOrEqual(14);
  });

  it("seeds a schema that documents the loader field", () => {
    const dir = join(tempDir(), "themes");
    seedThemes({ dir });
    const schema = JSON.parse(readFileSync(join(dir, "theme.schema.json"), "utf8")) as {
      properties?: { loader?: { enum?: string[] } };
      allOf?: Array<{ then?: { not?: { anyOf?: Array<{ required?: string[] }> } } }>;
    };
    expect(schema.properties?.loader?.enum).toEqual([
      "classic",
      "dots",
      "bars",
      "ring",
      "pulse",
      "braille",
    ]);
    const forbidden = schema.allOf?.[0]?.then?.not?.anyOf ?? [];
    expect(forbidden.some((entry) => entry.required?.includes("loader"))).toBe(true);
  });

  it("keeps an existing theme without loader valid and normalized to classic", () => {
    const dir = join(tempDir(), "themes");
    seedThemes({ dir });
    const raw = JSON.parse(readFileSync(join(dir, "nord.json"), "utf8")) as Record<string, unknown>;
    delete raw.loader;
    writeFileSync(join(dir, "nord.json"), JSON.stringify(raw));
    const theme = validateTheme("nord", raw);
    expect(theme.kind).not.toBe("auto");
    if (theme.kind !== "auto") {
      expect(theme.loader).toBe("classic");
    }
  });

  it("seeds the custom Shiki schema without overwriting it", () => {
    const dir = join(tempDir(), "themes");
    const first = seedThemes({ dir });
    expect(first.created).toContain("shiki-theme.schema.json");
    const path = join(dir, "shiki-theme.schema.json");
    writeFileSync(path, "{edited");
    const second = seedThemes({ dir });
    expect(second.skipped).toContain("shiki-theme.schema.json");
    expect(readFileSync(path, "utf8")).toBe("{edited");
  });

  it("does not overwrite an edited or invalid existing theme", () => {    const dir = join(tempDir(), "themes");
    seedThemes({ dir });
    writeFileSync(join(dir, "nord.json"), "{edited");
    const result = seedThemes({ dir });
    expect(result.created).not.toContain("nord");
    expect(readFileSync(join(dir, "nord.json"), "utf8")).toBe("{edited");
  });

  it("treats a symlink as an existing file and never follows it", () => {
    const dir = join(tempDir(), "themes");
    const outside = join(tempDir(), "outside.json");
    writeFileSync(outside, "keep");
    mkdirSync(dir, { recursive: true });
    symlinkSync(outside, join(dir, "nord.json"));
    const result = seedThemes({ dir });
    expect(result.skipped).toContain("nord");
    expect(readFileSync(outside, "utf8")).toBe("keep");
  });
});
