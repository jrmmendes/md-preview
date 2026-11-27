import { describe, expect, it } from "bun:test";

import { jsonForScript, renderPage } from "../src/core/page";
import { themeNames } from "../src/core/themes/tokens";

const SHELL = `<!DOCTYPE html>
<html data-theme="{{mdprv-theme}}" data-theme-kind="{{mdprv-theme-kind}}" data-scheme="{{mdprv-scheme}}" data-shiki-light="{{mdprv-shiki-light}}" data-shiki-dark="{{mdprv-shiki-dark}}" data-emoji="{{mdprv-emoji}}" data-loader="{{mdprv-loader}}" data-loader-dark="{{mdprv-loader-dark}}" data-zoom-sensitivity="{{mdprv-zoom}}">
<head><title>{{mdprv-title}}</title><style id="mdprv-theme-css">{{mdprv-theme-css}}</style></head>
<body>
<div class="mdprv-loader--{{mdprv-loader}}"></div>
<div id="mdprv-settings-root"></div>
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
    const html = renderPage(
      input({ loader: "braille", loaderFrom: "env", zoomSensitivity: 1.5 }),
      SHELL
    );
    expect(html).not.toContain("{{mdprv-");
    expect(html).toContain('data-theme="auto"');
    expect(html).toContain('data-theme-kind="auto"');
    expect(html).toContain('data-scheme="light"');
    expect(html).toContain('data-emoji="github"');
    expect(html).toContain('data-loader="braille"');
    expect(html).toContain('data-loader-dark="braille"');
    expect(html).toContain('data-zoom-sensitivity="1.5"');
    expect(html).toContain("mdprv-loader--braille");
  });

  it("uses the theme loader when no explicit choice was made", () => {
    const nord = renderPage(input({ themeName: "nord" }), SHELL);
    expect(nord).toContain('data-scheme="dark"');
    expect(nord).toContain('data-loader="ring"');
    expect(nord).toContain('data-loader-dark="ring"');
    expect(nord).toContain("mdprv-loader--ring");
  });

  it("keeps an explicit loader above the theme preset", () => {
    const html = renderPage(
      input({ themeName: "nord", loader: "braille", loaderFrom: "file" }),
      SHELL
    );
    expect(html).toContain('data-loader="braille"');
    expect(html).toContain('data-loader-dark="braille"');
  });

  it("emits the light loader and a separate dark loader for auto themes", () => {
    const html = renderPage(input({ themeName: "auto" }), SHELL);
    expect(html).toContain('data-loader="classic"');
    expect(html).toContain('data-loader-dark="classic"');
    expect(html).toContain('data-scheme="light"');
  });

  it("no longer renders server-side theme and loader option lists", () => {
    const html = renderPage(input(), SHELL);
    expect(html).not.toContain("<option");
    expect(html).not.toContain("{{mdprv-theme-options}}");
    expect(html).not.toContain("{{mdprv-loader-options}}");
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
    // A theme that declares its own scale (Breeze = near-square Plasma scale)
    // wins over the default token block.
    const breeze = renderPage(input({ themeName: "breeze-dark" }), SHELL);
    expect(breeze).toContain("--mdprv-radius-sm:0px");
    expect(breeze).toContain("--mdprv-radius-md:2px");
    expect(breeze).toContain("--mdprv-radius-xl:4px");
    expect(breeze).toContain('data-theme-kind="dark"');
    const breezeAuto = renderPage(input({ themeName: "breeze" }), SHELL);
    expect(breezeAuto).toContain('data-theme-kind="auto"');
    expect(breezeAuto).toContain("--mdprv-radius-md:2px");
    expect(html).toContain('"mermaid"');
    expect(html).toContain('"light"');
    expect(html).toContain('"dark"');
  });


  it("emits the auto dark block instead of a media query", () => {
    const html = renderPage(input({ themeName: "auto" }), SHELL);
    expect(html).toContain('html[data-scheme="dark"]{');
    expect(html).not.toContain("prefers-color-scheme");
    expect(html).not.toContain("@media");
  });

  it("ships the theme and loader preset through the catalog", () => {
    const html = renderPage(input({ themeName: "auto" }), SHELL);
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      catalog?: Array<{ name?: string; presets?: { light?: { loader?: string } } }>;
    };
    expect(data.catalog?.map((entry) => entry.name)).toEqual(themeNames());
    const auto = data.catalog?.find((entry) => entry.name === "auto");
    expect(auto?.presets?.light?.loader).toBe("classic");
  });

  it("ships the theme, catalog and config payload", () => {
    const html = renderPage(
      input({ themeName: "nord" }),
      SHELL,
      undefined,
      {
        config: {
          port: 8766,
          idleMinutes: 15,
          seedThemes: true,
          paths: { config: "/c/config.json", themes: "/c/themes", emojis: "/c/emojis", icons: "/c/icons", state: "/s/daemon.json" },
        },
      }
    );
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    expect(payload).not.toBeNull();
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      raw?: string;
      mermaid?: unknown;
      theme?: { name?: string; kind?: string; scheme?: string; loaders?: unknown };
      catalog?: Array<{ name?: string; presets?: unknown; swatch?: unknown }>;
      config?: { port?: number; paths?: { themes?: string } };
    };
    expect(data.theme?.name).toBe("nord");
    expect(data.theme?.kind).toBe("dark");
    expect(data.theme?.scheme).toBe("dark");
    expect(data.theme?.loaders).toEqual({ light: "ring", dark: "ring" });
    expect(data.catalog?.map((entry) => entry.name)).toEqual(themeNames());
    expect(data.catalog?.[0]?.presets).toBeDefined();
    expect(data.catalog?.[0]?.swatch).toBeDefined();
    expect(data.catalog?.[0]).not.toHaveProperty("mermaidOverrides");
    expect(data.config?.port).toBe(8766);
    expect(data.config?.paths?.themes).toBe("/c/themes");
    expect(data.mermaid).toBeDefined();
  });

  it("applies per-browser Shiki overrides before emitting the payload", () => {
    const html = renderPage(input({ themeName: "auto" }), SHELL, undefined, {
      prefs: {
        v: 1,
        shiki: { light: "solarized-light", dark: "dracula" },
        mermaid: { light: "forest", dark: "dark" },
      },
    });
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      theme?: { shiki?: unknown; mermaidTheme?: unknown };
      mermaid?: { light?: { theme?: string }; dark?: { theme?: string } };
    };
    expect(data.theme?.shiki).toEqual({ light: "solarized-light", dark: "dracula" });
    expect(data.theme?.mermaidTheme).toEqual({ light: "forest", dark: "dark" });
    expect(data.mermaid?.light?.theme).toBe("forest");
    expect(data.mermaid?.dark?.theme).toBe("dark");
  });

  it("ships the dynamic Shiki catalog and effective pair attributes", () => {
    const html = renderPage(input({ themeName: "nord" }), SHELL);
    expect(html).toContain('data-shiki-light="nord"');
    expect(html).toContain('data-shiki-dark="nord"');
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      shikiThemes?: Array<{ name?: string; kind?: string; source?: string }>;
    };
    expect(data.shikiThemes?.length).toBe(65);
    expect(data.shikiThemes?.every((theme) => theme.source === "builtin")).toBe(true);
    expect(data.shikiThemes?.some((theme) => theme.name === "tokyo-night")).toBe(true);
  });

  it("ships the active emoji pack and catalog", () => {
    const html = renderPage(input(), SHELL, undefined, { emojiName: "github" });
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      emoji?: { name?: string; style?: string };
      emojis?: Array<{ name?: string; source?: string; style?: string; count?: number }>;
    };
    expect(data.emoji).toEqual({ name: "github", style: "native" });
    expect(data.emojis?.[0]?.name).toBe("github");
    expect(data.emojis?.[0]?.source).toBe("builtin");
    expect(data.emojis?.[0]?.count).toBeGreaterThanOrEqual(80);
  });

  it("ships the active icon pack and catalog", () => {
    const html = renderPage(input(), SHELL, undefined, { iconName: "breeze" });
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    const data = JSON.parse(payload?.[1] ?? "{}") as {
      icons?: { name?: string; style?: string };
      iconPacks?: Array<{ name?: string; source?: string; default?: boolean }>;
    };
    expect(data.icons).toEqual({ name: "breeze", style: "symbolic" });
    expect(data.iconPacks?.[0]?.name).toBe("breeze");
    expect(data.iconPacks?.[0]?.source).toBe("builtin");
    expect(data.iconPacks?.[0]?.default).toBe(true);
  });

  it("escapes '<' in JSON so it cannot close the script block", () => {
    expect(jsonForScript({ value: "</script>" })).toBe('{"value":"\\u003c/script>"}');
  });

  it("ships the raw Markdown source in the JSON payload", () => {
    const raw = "---\ntitle: T\n---\n# Body\n\n<script>x</script>\n";
    const html = renderPage(input({ raw }), SHELL);
    const payload = html.match(/id="mdprv-data">([\s\S]*?)<\/script>/);
    expect(payload).not.toBeNull();
    const data = JSON.parse(payload?.[1] ?? "{}") as { raw?: string };
    expect(data.raw).toBe(raw);
    expect(html).not.toContain("</script>x");
  });
});
