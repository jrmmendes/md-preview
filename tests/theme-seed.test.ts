import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seedThemes } from "../src/core/themes/seed";

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
    expect(first.created).toHaveLength(10);
    expect(existsSync(join(dir, "theme.schema.json"))).toBe(true);

    const second = seedThemes({ dir });
    expect(second.created).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThanOrEqual(10);
  });

  it("does not overwrite an edited or invalid existing theme", () => {
    const dir = join(tempDir(), "themes");
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
