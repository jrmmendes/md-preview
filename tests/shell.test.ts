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

  it("exposes an accessible font combobox without a datalist", () => {
    expect(SHELL).not.toContain("<datalist");
    expect(SHELL).not.toContain("queryLocalFonts");
    expect(SHELL).toContain('<input id="mdprv-font"');
    expect(SHELL).toContain('role="combobox"');
    expect(SHELL).toContain('aria-controls="mdprv-font-list"');
    expect(SHELL).toContain('aria-autocomplete="list"');
    expect(SHELL).toContain('aria-activedescendant=""');
    expect(SHELL).toContain('<ul id="mdprv-font-list"');
    expect(SHELL).toContain('role="listbox"');
    expect(SHELL).toContain('id="mdprv-font-status"');
    expect(SHELL).toContain('role="status"');
    expect(SHELL).toContain('aria-live="polite"');
    expect(SHELL).toContain('id="mdprv-font-refresh"');
    expect(SHELL).toContain('id="mdprv-font-reset"');
    expect(SHELL).toContain('id="mdprv-font-google-family"');
    expect(SHELL).toContain('id="mdprv-font-google-load"');
  });

  it("activates the selection before the body through the inline script", () => {
    const head = SHELL.slice(0, SHELL.indexOf("<body>"));
    expect(head).toContain('local("mdprv_font")');
    expect(head).toContain("--mdprv-font");
    expect(head).toContain("/__fonts/google?family=");
    expect(head).toContain('id = "mdprv-font-google-css"');
    expect(head).toContain("data-font-missing");
  });
});
