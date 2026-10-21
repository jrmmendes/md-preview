import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL = readFileSync(join(import.meta.dir, "../src/ui/index.html"), "utf8");

function ids(html: string): string[] {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
}

describe("ui shell", () => {
  it("has no duplicate element ids", () => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids(SHELL)) {
      if (seen.has(id)) {
        duplicates.add(id);
      }
      seen.add(id);
    }
    expect([...duplicates]).toEqual([]);
  });

  it("keeps the theme style and select ids distinct", () => {
    const all = ids(SHELL);
    expect(all.filter((id) => id === "mdprv-theme")).toHaveLength(1);
    expect(all.filter((id) => id === "mdprv-theme-css")).toHaveLength(1);
    expect(SHELL).toContain('<select id="mdprv-theme"');
    expect(SHELL).toContain('<style id="mdprv-theme-css">');
    expect(SHELL).toContain('<label class="mdprv-field-label" for="mdprv-theme">');
  });
});
