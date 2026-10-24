import { describe, expect, it } from "bun:test";

import { jsonForScript, renderPage } from "../src/core/page";
import { themeNames } from "../src/core/themes/tokens";

const SHELL = `<!DOCTYPE html>
<html data-theme="{{mdprv-theme}}" data-loader="{{mdprv-loader}}" data-zoom-sensitivity="{{mdprv-zoom}}">
<head><title>{{mdprv-title}}</title><style id="mdprv-theme-css">{{mdprv-theme-css}}</style></head>
<body>
<select id="mdprv-theme">{{mdprv-theme-options}}</select>
<select id="mdprv-loader">{{mdprv-loader-options}}</select>
<div class="mdprv-loader--{{mdprv-loader}}"></div>
<article class="markdown-body">{{mdprv-meta}}{{mdprv-body}}</article>
<script type="application/json" id="mdprv-data">{{mdprv-data}}</script>
</body></html>`;

function input(overrides: Partial<Parameters<typeof renderPage>[0]> = {}) {
  return {
    title: "Título",
    body: "<p>corpo</p>",
    themeName: "auto",
    loader: "classic" as const,
    zoomSensitivity: 1.1,
    ...overrides,
  };
}

describe("renderPage", () => {
  it("fills every token, including repeated loader tokens", () => {
    const html = renderPage(input({ loader: "braille", zoomSensitivity: 1.5 }), SHELL);
    expect(html).not.toContain("{{mdprv-");
    expect(html).toContain('data-theme="auto"');
    expect(html).toContain('data-loader="braille"');
    expect(html).toContain('data-zoom-sensitivity="1.5"');
    expect(html).toContain("mdprv-loader--braille");
  });

  it("renders theme and loader options on the server", () => {
    const html = renderPage(input(), SHELL);
    expect(html).toContain('<option value="auto" selected>auto</option>');
    expect(html).toContain('<option value="nord">nord</option>');
    expect(html).toContain('<option value="classic" selected>classic</option>');
    expect(html).toContain('<option value="braille">braille</option>');
  });

  it("escapes the title and injects the body last", () => {
    const html = renderPage(
      input({ title: '<script>"x"</script>', body: "<p>{{mdprv-title}}</p>" }),
      SHELL
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<p>{{mdprv-title}}</p>");
    expect(html).not.toContain("<p>Título</p>");
  });

  it("includes theme CSS and the Mermaid payload", () => {
    const html = renderPage(input({ themeName: "nord" }), SHELL);
    expect(html).toContain("--mdprv-bg:#2e3440");
    expect(html).toContain("--mdprv-radius-md:6px");
    expect(html).toContain("--mdprv-font-stack:");
    expect(html).toContain('"mermaid"');
    expect(html).toContain('"light"');
    expect(html).toContain('"dark"');
  });


  it("emits the auto dark rule and theme options in catalog order", () => {
    const html = renderPage(input({ themeName: "auto" }), SHELL);
    expect(html).toContain("@media (prefers-color-scheme: dark)");
    const select = html.match(/id="mdprv-theme">([\s\S]*?)<\/select>/);
    expect(select).not.toBeNull();
    const values = [...(select?.[1] ?? "").matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(values).toEqual(themeNames());
    expect(values[0]).toBe("auto");
    expect(values.slice(1)).toEqual([...values.slice(1)].sort((a, b) => a.localeCompare(b)));
  });

  it("escapes '<' in JSON so it cannot close the script block", () => {
    expect(jsonForScript({ value: "</script>" })).toBe('{"value":"\\u003c/script>"}');
  });
});
