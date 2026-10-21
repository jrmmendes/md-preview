import type { FixedTheme, MermaidThemeName, ResolvedTheme, Tokens } from "./tokens";

export interface MermaidConfig {
  theme: MermaidThemeName;
  themeVariables: Record<string, string>;
}

export interface MermaidPayload {
  light: MermaidConfig;
  dark: MermaidConfig;
}

export function defaultMermaidVariables(tokens: Tokens): Record<string, string> {
  return {
    background: tokens.bg,
    primaryColor: tokens["code-bg"],
    mainBkg: tokens["code-bg"],
    primaryTextColor: tokens.fg,
    textColor: tokens.fg,
    titleColor: tokens.fg,
    lineColor: tokens.link,
    nodeBorder: tokens.link,
    primaryBorderColor: tokens.link,
    clusterBorder: tokens.border,
    secondaryColor: tokens.muted,
    tertiaryColor: tokens.bg,
    clusterBkg: tokens.bg,
    edgeLabelBackground: tokens.bg,
  };
}

export function mermaidConfig(theme: FixedTheme): MermaidConfig {
  return {
    theme: theme.mermaid.theme,
    themeVariables: {
      ...defaultMermaidVariables(theme.tokens),
      ...theme.mermaid.overrides,
    },
  };
}

export function mermaidPayload(theme: ResolvedTheme): MermaidPayload {
  return {
    light: mermaidConfig(theme.light),
    dark: mermaidConfig(theme.dark),
  };
}
