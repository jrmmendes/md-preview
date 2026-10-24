import { DEFAULT_FONT_STACK } from "../fonts";
import type {
  ThemeColors,
  ThemeEffects,
  ThemeLayout,
  ThemeRadii,
  ThemeTypography,
} from "./types";

export const DEFAULT_RADII: ThemeRadii = {
  none: 0,
  sm: 5,
  md: 6,
  lg: 8,
  xl: 12,
  pill: 999,
  circle: 9999,
};

export const DEFAULT_TYPOGRAPHY: ThemeTypography = {
  family: "system-ui",
  stack: DEFAULT_FONT_STACK,
  "mono-stack": 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  "base-size": 17,
  "ui-size": 13,
  "small-size": 11.5,
  "line-height": 1.65,
  "heading-line-height": 1.25,
  "code-line-height": 1,
  "weight-normal": 400,
  "weight-bold": 600,
};

export const DEFAULT_LAYOUT: ThemeLayout = {
  "content-width": "46rem",
  "sidebar-width": "16rem",
  "scroll-offset": "7rem",
  "article-padding-y": "2.5rem",
  "article-padding-x": "1.25rem",
  "article-padding-bottom": "6rem",
  "control-height": "1.9rem",
  "code-padding": "1em",
  "table-cell-padding": ".4em .75em",
};

export const DEFAULT_EFFECTS: ThemeEffects = {
  "shadow-panel": "0 8px 28px rgba(0,0,0,.28)",
  overlay: "rgba(0,0,0,.55)",
  blur: "8px",
  "duration-fast": ".15s",
  "duration-ui": ".18s",
  easing: "ease",
};

export const DEFAULT_OPTIONAL_COLORS = {
  "surface-raised": "",
  "border-strong": "",
  "accent-fg": "",
  link: "",
  "code-fg": "",
  danger: "#c0392b",
  warning: "#b58900",
  success: "#2e7d32",
  info: "#268bd2",
  selection: "",
} as const;

export function withDefaults(
  colors: Pick<ThemeColors, "background" | "surface" | "text" | "muted" | "border" | "accent" | "code-bg" | "quote"> &
    Partial<ThemeColors>,
  radii: Partial<ThemeRadii> | undefined,
  typography: Partial<ThemeTypography> | undefined,
  layout: Partial<ThemeLayout> | undefined,
  effects: Partial<ThemeEffects> | undefined
): {
  colors: ThemeColors;
  radii: ThemeRadii;
  typography: ThemeTypography;
  layout: ThemeLayout;
  effects: ThemeEffects;
} {
  return {
    colors: {
      background: colors.background,
      surface: colors.surface,
      "surface-raised": colors["surface-raised"] ?? colors.surface,
      text: colors.text,
      muted: colors.muted,
      border: colors.border,
      "border-strong": colors["border-strong"] ?? colors.border,
      accent: colors.accent,
      "accent-fg": colors["accent-fg"] ?? colors.background,
      link: colors.link ?? colors.accent,
      "code-bg": colors["code-bg"],
      "code-fg": colors["code-fg"] ?? colors.text,
      quote: colors.quote,
      danger: colors.danger ?? DEFAULT_OPTIONAL_COLORS.danger,
      warning: colors.warning ?? DEFAULT_OPTIONAL_COLORS.warning,
      success: colors.success ?? DEFAULT_OPTIONAL_COLORS.success,
      info: colors.info ?? DEFAULT_OPTIONAL_COLORS.info,
      selection: colors.selection ?? colors.accent,
    },
    radii: { ...DEFAULT_RADII, ...radii },
    typography: { ...DEFAULT_TYPOGRAPHY, ...typography },
    layout: { ...DEFAULT_LAYOUT, ...layout },
    effects: { ...DEFAULT_EFFECTS, ...effects },
  };
}
