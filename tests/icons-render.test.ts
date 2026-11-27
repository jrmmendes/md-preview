import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createIconStore } from "../src/core/icons/store";
import { setIconStore } from "../src/core/icons/index";
import { resolveIconPackName } from "../src/core/icons/resolve";
import { renderMarkdown } from "../src/core/markdown/render";
import { renderPage } from "../src/core/page";

const SHELL = `<!DOCTYPE html>
<html data-emoji="{{mdprv-emoji}}" data-icons="{{mdprv-icons}}">
<head>
<style id="mdprv-theme-css">{{mdprv-theme-css}}</style>
<style id="mdprv-icon-css">{{mdprv-icon-css}}</style>
</head>
<body>
<div class="mdprv-loader--{{mdprv-loader}}"></div>
<article class="markdown-body">{{mdprv-meta}}{{mdprv-body}}</article>
<script type="application/json" id="mdprv-data">{{mdprv-data}}</script>
</body></html>`;

const dirs: string[] = [];

function input(overrides: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return {
    title: "Título",
    body: '<p><span class="mdprv-icon" data-icon="copy"></span></p>',
    themeName: "auto",
    loader: "classic" as const,
    zoomSensitivity: 1.1,
    ...overrides,
  };
}

function payload(html: string): Record<string, unknown> {
  const match = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

afterEach(() => {
  setIconStore(null);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("icon rendering", () => {
  it("emits one mask URL per key and the active slug", () => {
    const html = renderPage(input(), SHELL, undefined, { iconName: "breeze" });
    expect(html).not.toContain("{{mdprv-");
    expect(html).toContain('data-icons="breeze"');
    expect(html).toContain('--mdprv-icon-copy:url("/__icon-assets/breeze/copy.svg")');
    expect(html).toContain('--mdprv-icon-chart-scatter:url("/__icon-assets/breeze/chart-scatter.svg")');
    expect(payload(html).icons).toEqual({ name: "breeze", style: "symbolic" });
  });

  it("falls back to the builtin pack for an unknown selection", () => {
    const html = renderPage(input(), SHELL, undefined, { iconName: "does-not-exist" });
    expect(html).toContain('data-icons="breeze"');
    expect(html).toContain("/__icon-assets/breeze/copy.svg");
  });

  it("never renders a user file under the reserved default name", () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-icons-render-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "breeze.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "breeze",
        style: "fullcolor",
        icons: { copy: "breeze/hijack.svg" },
      })
    );
    setIconStore(createIconStore({ dir, watch: false }));

    const html = renderPage(input(), SHELL, undefined, { iconName: "breeze" });
    expect(html).toContain('data-icons="breeze"');
    expect(payload(html).icons).toEqual({ name: "breeze", style: "symbolic" });

    const legacy = renderPage(input(), SHELL, undefined, { iconName: "default" });
    expect(legacy).toContain('data-icons="breeze"');
    expect(payload(legacy).icons).toEqual({ name: "breeze", style: "symbolic" });
  });

  it("resolves reserved query, cookie and config names to the builtin pack", () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-icons-render-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "breeze.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "breeze",
        style: "fullcolor",
        icons: { copy: "breeze/hijack.svg" },
      })
    );
    writeFileSync(
      join(dir, "custom.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "custom",
        style: "fullcolor",
        icons: { copy: "custom/copy.svg" },
      })
    );
    const store = createIconStore({ dir, watch: false });

    expect(resolveIconPackName("default", null, "custom", store)).toBe("breeze");
    expect(resolveIconPackName("breeze", "custom", "custom", store)).toBe("breeze");
    expect(resolveIconPackName(null, "breeze", "custom", store)).toBe("breeze");
    expect(resolveIconPackName(null, null, "default", store)).toBe("breeze");
    expect(resolveIconPackName(null, null, "custom", store)).toBe("custom");
  });

  it("uses the selected user pack in the custom properties", () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-icons-render-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "custom.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "custom",
        style: "fullcolor",
        icons: { copy: "custom/copy.svg" },
      })
    );
    mkdirSync(join(dir, "custom"), { recursive: true });
    writeFileSync(join(dir, "custom", "copy.svg"), "<svg/>");
    setIconStore(createIconStore({ dir, watch: false }));

    const html = renderPage(input(), SHELL, undefined, { iconName: "custom" });
    expect(html).toContain('data-icons="custom"');
    expect(html).toContain('--mdprv-icon-copy:url("/__icon-assets/custom/copy.svg")');
    expect(payload(html).icons).toEqual({ name: "custom", style: "fullcolor" });
  });

  it("keeps generated Markdown free of pack URLs so renderers stay cacheable", async () => {
    const html = await renderMarkdown(
      [
        "| a | b |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "```tree",
        "root",
        "└── src/",
        "    └── index.ts",
        "```",
        "",
        "```diff",
        "--- a/x",
        "+++ b/x",
        "@@ -1 +1 @@",
        "-old",
        "+new",
        "```",
        "",
      ].join("\n"),
      "auto",
      "doc"
    );

    // Server-side glyphs are key-only spans: no SVG markup and no pack URL, so
    // switching packs only changes the page CSS (no renderer cache key bump).
    expect(html).toContain('data-icon="filter"');
    expect(html).toContain('data-icon="copy"');
    expect(html).toContain('data-icon="chevron"');
    expect(html).toContain('data-icon="folder"');
    expect(html).toContain('data-icon="file"');
    expect(html).not.toContain("/__icon-assets/");
    expect(html).not.toContain("<svg");
  }, 30000);
});
