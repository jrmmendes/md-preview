export const DEFAULT_THEME = "auto";

export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const THEMES_DIR_NAME = "themes";

export const THEME_SCHEMA_FILE = "theme.schema.json";

export const CONFIG_FILE_NAME = "config.json";

export const CONFIG_SCHEMA_FILE = "config.schema.json";

export const MAX_THEME_FILE_BYTES = 256 * 1024;

export const MAX_MERMAID_OVERRIDES = 512;

/**
 * All themes shipped by `@shikijs/themes@3.23.0`, in package order.
 *
 * The list is the public allowlist for builtins; custom themes imported
 * through the settings modal are validated by `SHIKI_THEME_ID_RE` and the
 * custom store. `src/core/markdown/shiki-builtins.ts` is generated from the
 * same package and must stay in sync (see `scripts/gen-shiki-themes.ts`).
 */
export const SHIKI_THEME_NAMES = [
  "andromeeda",
  "aurora-x",
  "ayu-dark",
  "ayu-light",
  "ayu-mirage",
  "catppuccin-frappe",
  "catppuccin-latte",
  "catppuccin-macchiato",
  "catppuccin-mocha",
  "dark-plus",
  "dracula",
  "dracula-soft",
  "everforest-dark",
  "everforest-light",
  "github-dark",
  "github-dark-default",
  "github-dark-dimmed",
  "github-dark-high-contrast",
  "github-light",
  "github-light-default",
  "github-light-high-contrast",
  "gruvbox-dark-hard",
  "gruvbox-dark-medium",
  "gruvbox-dark-soft",
  "gruvbox-light-hard",
  "gruvbox-light-medium",
  "gruvbox-light-soft",
  "horizon",
  "horizon-bright",
  "houston",
  "kanagawa-dragon",
  "kanagawa-lotus",
  "kanagawa-wave",
  "laserwave",
  "light-plus",
  "material-theme",
  "material-theme-darker",
  "material-theme-lighter",
  "material-theme-ocean",
  "material-theme-palenight",
  "min-dark",
  "min-light",
  "monokai",
  "night-owl",
  "night-owl-light",
  "nord",
  "one-dark-pro",
  "one-light",
  "plastic",
  "poimandres",
  "red",
  "rose-pine",
  "rose-pine-dawn",
  "rose-pine-moon",
  "slack-dark",
  "slack-ochin",
  "snazzy-light",
  "solarized-dark",
  "solarized-light",
  "synthwave-84",
  "tokyo-night",
  "vesper",
  "vitesse-black",
  "vitesse-dark",
  "vitesse-light",
] as const;

export type BuiltinShikiThemeName = (typeof SHIKI_THEME_NAMES)[number];

/**
 * Builtin name or imported custom slug; runtime validates membership with
 * `SHIKI_THEME_ID_RE` + `isKnownShikiTheme()`.
 */
export type ShikiThemeName = string;

/** Syntax shared by builtins and custom slugs (max 32 chars). */
export const SHIKI_THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const MERMAID_THEMES = ["default", "neutral", "dark", "forest", "base"] as const;

export type BuiltinMermaidThemeName = (typeof MERMAID_THEMES)[number];

/**
 * Builtin widget name or an imported custom slug (`<name>.mermaid.json`).
 * Runtime membership is checked against `MERMAID_THEMES` plus the dynamic
 * custom store.
 */
export type MermaidThemeName = string;
