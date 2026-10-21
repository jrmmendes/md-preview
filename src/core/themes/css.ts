import type { ResolvedTheme, Tokens } from "./tokens";

export function tokenCss(tokens: Tokens): string {
  return [
    `--mdprv-bg:${tokens.bg}`,
    `--mdprv-fg:${tokens.fg}`,
    `--mdprv-muted:${tokens.muted}`,
    `--mdprv-link:${tokens.link}`,
    `--mdprv-border:${tokens.border}`,
    `--mdprv-code-bg:${tokens["code-bg"]}`,
    `--mdprv-quote:${tokens.quote}`,
  ].join(";");
}

export function themeCss(theme: ResolvedTheme): string {
  const light = `:root{${tokenCss(theme.light.tokens)}}`;
  if (theme.kind !== "auto") {
    return light;
  }
  const dark = `:root{${tokenCss(theme.dark.tokens)}}`;
  return [light, `@media (prefers-color-scheme: dark){${dark}}`].join("\n");
}
