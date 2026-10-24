import type { MermaidThemeName } from "./constants";
import type { FixedTheme, ResolvedTheme, ThemeColors } from "./types";

export interface MermaidConfig {
  theme: MermaidThemeName;
  themeVariables: Record<string, string>;
}

export interface MermaidPayload {
  light: MermaidConfig;
  dark: MermaidConfig;
}

export function defaultMermaidVariables(colors: ThemeColors): Record<string, string> {
  return {
    background: colors.background,
    primaryColor: colors["code-bg"],
    mainBkg: colors.surface,
    primaryTextColor: colors.text,
    textColor: colors.text,
    titleColor: colors.text,
    lineColor: colors.link,
    nodeBorder: colors.accent,
    primaryBorderColor: colors.accent,
    clusterBorder: colors.border,
    secondaryColor: colors.muted,
    tertiaryColor: colors.background,
    clusterBkg: colors.background,
    edgeLabelBackground: colors.background,
  };
}

export function mermaidConfig(theme: FixedTheme): MermaidConfig {
  return {
    theme: theme.mermaid.theme,
    themeVariables: {
      ...defaultMermaidVariables(theme.colors),
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
