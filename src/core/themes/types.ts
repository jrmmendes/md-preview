import type { MermaidThemeName, ShikiThemeName } from "./constants";

export interface ThemeColors {
  background: string;
  surface: string;
  "surface-raised": string;
  text: string;
  muted: string;
  border: string;
  "border-strong": string;
  accent: string;
  "accent-fg": string;
  link: string;
  "code-bg": string;
  "code-fg": string;
  quote: string;
  danger: string;
  warning: string;
  success: string;
  info: string;
  selection: string;
}

export interface ThemeRadii {
  none: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
  circle: number;
}

export interface ThemeTypography {
  family: string;
  stack: string;
  "mono-stack": string;
  "base-size": number;
  "ui-size": number;
  "small-size": number;
  "line-height": number;
  "heading-line-height": number;
  "code-line-height": number;
  "weight-normal": number;
  "weight-bold": number;
}

export interface ThemeLayout {
  "content-width": string;
  "sidebar-width": string;
  "scroll-offset": string;
  "article-padding-y": string;
  "article-padding-x": string;
  "article-padding-bottom": string;
  "control-height": string;
  "code-padding": string;
  "table-cell-padding": string;
}

export interface ThemeEffects {
  "shadow-panel": string;
  overlay: string;
  blur: string;
  "duration-fast": string;
  "duration-ui": string;
  easing: string;
}

export interface ThemeShiki {
  light: ShikiThemeName;
  dark: ShikiThemeName;
}

export interface ThemeMermaid {
  theme: MermaidThemeName;
  overrides: Record<string, string>;
}

interface BaseTheme {
  schemaVersion: 1;
  name: string;
}

export interface AutoTheme extends BaseTheme {
  kind: "auto";
  variants: { light: string; dark: string };
}

export interface FixedTheme extends BaseTheme {
  kind: "light" | "dark";
  colors: ThemeColors;
  radii: ThemeRadii;
  typography: ThemeTypography;
  layout: ThemeLayout;
  effects: ThemeEffects;
  shiki: ThemeShiki;
  mermaid: ThemeMermaid;
}

export type Theme = AutoTheme | FixedTheme;

export interface ResolvedTheme {
  name: string;
  kind: "auto" | "light" | "dark";
  light: FixedTheme;
  dark: FixedTheme;
}

export interface ThemeInfo {
  name: string;
  source: "builtin" | "user";
}

export interface ThemeError {
  file: string;
  message: string;
}
