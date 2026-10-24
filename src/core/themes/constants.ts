export const DEFAULT_THEME = "auto";

export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const THEMES_DIR_NAME = "themes";

export const THEME_SCHEMA_FILE = "theme.schema.json";

export const CONFIG_FILE_NAME = "config.json";

export const CONFIG_SCHEMA_FILE = "config.schema.json";

export const MAX_THEME_FILE_BYTES = 256 * 1024;

export const MAX_MERMAID_OVERRIDES = 512;

export const SHIKI_THEME_NAMES = [
  "github-light",
  "github-dark",
  "dracula",
  "nord",
  "solarized-dark",
  "solarized-light",
  "gruvbox-dark-medium",
  "gruvbox-light-medium",
] as const;

export type ShikiThemeName = (typeof SHIKI_THEME_NAMES)[number];

export const MERMAID_THEMES = ["default", "neutral", "dark", "forest", "base"] as const;

export type MermaidThemeName = (typeof MERMAID_THEMES)[number];
