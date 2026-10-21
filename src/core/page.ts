import { LOADERS } from "./config";
import type { PageInput } from "./contract";
import { renderMeta } from "./meta";
import { themeCss } from "./themes/css";
import { mermaidPayload } from "./themes/mermaid";
import { getTheme, themeNames } from "./themes/tokens";

function themeOptions(selected: string): string {
  return themeNames()
    .map(
      (name) =>
        `<option value="${Bun.escapeHTML(name)}"${name === selected ? " selected" : ""}>${Bun.escapeHTML(name)}</option>`
    )
    .join("");
}

function loaderOptions(selected: string): string {
  return LOADERS.map(
    (name) =>
      `<option value="${Bun.escapeHTML(name)}"${name === selected ? " selected" : ""}>${Bun.escapeHTML(name)}</option>`
  ).join("");
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPage(input: PageInput, shell: string): string {
  const theme = getTheme(input.themeName);
  const mermaid = mermaidPayload(theme);

  const fill: Array<[string, string]> = [
    ["{{mdprv-title}}", Bun.escapeHTML(input.title)],
    ["{{mdprv-theme}}", theme.name],
    ["{{mdprv-theme-options}}", themeOptions(theme.name)],
    ["{{mdprv-loader}}", input.loader],
    ["{{mdprv-loader-options}}", loaderOptions(input.loader)],
    ["{{mdprv-zoom}}", String(input.zoomSensitivity)],
    ["{{mdprv-theme-css}}", themeCss(theme)],
    ["{{mdprv-meta}}", renderMeta(input.meta)],
    ["{{mdprv-data}}", jsonForScript({ mermaid })],
  ];

  const out = fill.reduce((html, [token, value]) => html.split(token).join(value), shell);
  return out.split("{{mdprv-body}}").join(input.body);
}
