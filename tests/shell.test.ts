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

  it("keeps a single theme style and no legacy settings panel", () => {
    const all = ids(SHELL);
    expect(all.filter((id) => id === "mdprv-theme-css")).toHaveLength(1);
    expect(SHELL).toContain('<style id="mdprv-theme-css">');
    expect(SHELL).not.toContain('<div class="mdprv-settings"');
    expect(SHELL).not.toContain('id="mdprv-settings"');
    expect(SHELL).not.toContain('<select id="mdprv-theme"');
    expect(SHELL).not.toContain('<select id="mdprv-loader"');
    expect(SHELL).not.toContain("{{mdprv-theme-options}}");
    expect(SHELL).not.toContain("{{mdprv-loader-options}}");
    expect(SHELL).not.toContain("mdprv-field-label");
    expect(SHELL).not.toContain("mdprv-font-picker");
    expect(SHELL).not.toContain("mdprv-zoom-sens");
    expect(SHELL).not.toContain('id="mdprv-simple-table"');
    expect(SHELL).not.toContain('id="mdprv-simple-diff"');
  });

  it("hosts the settings modal root and trigger contract", () => {
    expect(SHELL).toContain('<div id="mdprv-settings-root"></div>');
    expect(SHELL).toContain('id="mdprv-settings-toggle"');
    expect(SHELL).toContain('aria-haspopup="dialog"');
    expect(SHELL).toContain('aria-controls="mdprv-settings-dialog"');
    expect(SHELL).toContain('aria-expanded="false"');
    expect(ids(SHELL).filter((id) => id === "mdprv-settings-root")).toHaveLength(1);
    // The dialog itself is created by settings/modal and never duplicated in
    // the shell.
    expect(ids(SHELL)).not.toContain("mdprv-settings-dialog");
  });

  it("leaves the settings controls to the modal island", () => {
    expect(SHELL).not.toContain("<datalist");
    expect(SHELL).not.toContain("queryLocalFonts");
    expect(SHELL).not.toContain('id="mdprv-font"');
    expect(SHELL).not.toContain('id="mdprv-font-list"');
    expect(SHELL).not.toContain('id="mdprv-font-status"');
    expect(SHELL).not.toContain('id="mdprv-font-refresh"');
    expect(SHELL).not.toContain('id="mdprv-font-reset"');
    expect(SHELL).not.toContain('id="mdprv-font-google-family"');
    expect(SHELL).not.toContain('id="mdprv-font-google-load"');
  });

  it("activates the selection before the body through the inline script", () => {
    const head = SHELL.slice(0, SHELL.indexOf("<body>"));
    expect(head).toContain('local("mdprv_font")');
    expect(head).toContain("--mdprv-font");
    expect(head).toContain("/__fonts/google?family=");
    expect(head).toContain('id = "mdprv-font-google-css"');
    expect(head).toContain("data-font-missing");
  });

  it("exposes an explicit effective scheme and per-scheme loader", () => {
    expect(SHELL).toContain('data-scheme="{{mdprv-scheme}}"');
    expect(SHELL).toContain('data-shiki-light="{{mdprv-shiki-light}}"');
    expect(SHELL).toContain('data-shiki-dark="{{mdprv-shiki-dark}}"');
    expect(SHELL).toContain('data-loader="{{mdprv-loader}}"');
    expect(SHELL).toContain('data-loader-dark="{{mdprv-loader-dark}}"');
    const head = SHELL.slice(0, SHELL.indexOf("<body>"));
    expect(head).toContain("data-scheme");
    expect(head).toContain("matchMedia");
    expect(head).toContain("data-loader-dark");
  });

  it("ships the JSON payload consumed by the islands", () => {
    expect(SHELL).toContain('<script type="application/json" id="mdprv-data">{{mdprv-data}}</script>');
    expect(SHELL).toContain("<style id=\"mdprv-theme-css\">{{mdprv-theme-css}}</style>");
  });

  it("exposes a single visually hidden live status region", () => {
    const all = ids(SHELL);
    expect(all.filter((id) => id === "mdprv-status")).toHaveLength(1);
    expect(SHELL).toContain('<p id="mdprv-status" class="mdprv-sr-only" role="status" aria-live="polite"></p>');
    expect(SHELL).toContain('class="mdprv-mermaid-status"');
  });

  it("keeps an empty state for when the document in view is closed", () => {
    expect(SHELL).toContain('<article id="mdprv-doc" class="markdown-body" tabindex="-1">');
    expect(SHELL).toContain('<section id="mdprv-closed" class="mdprv-closed-state" aria-labelledby="mdprv-closed-title" hidden>');
    expect(SHELL).toContain('<h2 id="mdprv-closed-title" tabindex="-1">No document open</h2>');
    expect(SHELL).toContain("md-preview &lt;file&gt;");
    expect(SHELL).not.toContain("mdprv-reopen");
    expect(ids(SHELL).filter((id) => id === "mdprv-closed")).toHaveLength(1);
  });

  it("has no global close or folder controls", () => {
    expect(SHELL).not.toContain('id="mdprv-close"');
    expect(SHELL).not.toContain('id="mdprv-folder"');
    expect(SHELL).not.toContain("mdprv-folder-dialog");
    expect(SHELL).not.toContain("{{mdprv-folder-hidden}}");
    expect(SHELL).toContain('<ul class="mdprv-history-list" id="mdprv-history-list"></ul>');
  });
});
