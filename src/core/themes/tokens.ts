import autoRaw from "./catalog/auto.json";
import draculaRaw from "./catalog/dracula.json";
import githubDarkRaw from "./catalog/github-dark.json";
import githubLightRaw from "./catalog/github-light.json";
import gruvboxDarkRaw from "./catalog/gruvbox-dark.json";
import gruvboxLightRaw from "./catalog/gruvbox-light.json";
import nordRaw from "./catalog/nord.json";
import solarizedDarkRaw from "./catalog/solarized-dark.json";
import solarizedLightRaw from "./catalog/solarized-light.json";

export const TOKEN_NAMES = ["bg", "fg", "muted", "link", "border", "code-bg", "quote"] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

export type Tokens = Record<TokenName, string>;

export const MERMAID_THEMES = ["default", "neutral", "dark", "forest", "base"] as const;

export type MermaidThemeName = (typeof MERMAID_THEMES)[number];

export interface FixedTheme {
  name: string;
  kind: "light" | "dark";
  tokens: Tokens;
  shiki: { light: string; dark: string };
  mermaid: { theme: MermaidThemeName; overrides: Record<string, string> };
}

export interface AutoTheme {
  name: string;
  kind: "auto";
  variants: { light: string; dark: string };
}

export type Theme = AutoTheme | FixedTheme;

export interface ResolvedTheme {
  name: string;
  kind: "auto" | "light" | "dark";
  light: FixedTheme;
  dark: FixedTheme;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(fileName: string, message: string): never {
  throw new Error(`invalid theme ${fileName}: ${message}`);
}

function validateTokens(fileName: string, raw: unknown): Tokens {
  if (!isRecord(raw)) {
    fail(fileName, "tokens must be an object");
  }
  const tokens = {} as Tokens;
  for (const key of TOKEN_NAMES) {
    const value = raw[key];
    if (typeof value !== "string" || !COLOR.test(value)) {
      fail(fileName, `token ${key} must be a #rrggbb color`);
    }
    tokens[key] = value;
  }
  return tokens;
}

function validateShiki(fileName: string, raw: unknown): { light: string; dark: string } {
  if (!isRecord(raw) || typeof raw.light !== "string" || raw.light === "") {
    fail(fileName, "shiki.light must be a non-empty string");
  }
  if (typeof raw.dark !== "string" || raw.dark === "") {
    fail(fileName, "shiki.dark must be a non-empty string");
  }
  return { light: raw.light, dark: raw.dark };
}

function validateMermaid(
  fileName: string,
  raw: unknown
): { theme: MermaidThemeName; overrides: Record<string, string> } {
  if (!isRecord(raw)) {
    fail(fileName, "mermaid must be an object");
  }
  if (typeof raw.theme !== "string" || !(MERMAID_THEMES as readonly string[]).includes(raw.theme)) {
    fail(fileName, "mermaid.theme is not a known Mermaid theme");
  }
  if (!isRecord(raw.overrides)) {
    fail(fileName, "mermaid.overrides must be an object");
  }
  const overrides: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.overrides)) {
    if (typeof value !== "string") {
      fail(fileName, `mermaid.overrides.${key} must be a string`);
    }
    overrides[key] = value;
  }
  return { theme: raw.theme as MermaidThemeName, overrides };
}

export function validateTheme(fileName: string, raw: unknown): Theme {
  if (!isRecord(raw)) {
    fail(fileName, "theme must be an object");
  }
  if (typeof raw.name !== "string" || raw.name !== fileName) {
    fail(fileName, `name must equal the file name (${fileName})`);
  }
  if (raw.kind === "auto") {
    if (raw.tokens !== undefined || raw.shiki !== undefined || raw.mermaid !== undefined) {
      fail(fileName, "auto themes cannot define tokens, shiki or mermaid");
    }
    if (!isRecord(raw.variants)) {
      fail(fileName, "auto themes require variants");
    }
    const { light, dark } = raw.variants;
    if (typeof light !== "string" || light === "" || typeof dark !== "string" || dark === "") {
      fail(fileName, "variants.light and variants.dark must be non-empty strings");
    }
    return { name: raw.name, kind: "auto", variants: { light, dark } };
  }
  if (raw.kind === "light" || raw.kind === "dark") {
    if (raw.variants !== undefined) {
      fail(fileName, "fixed themes cannot define variants");
    }
    return {
      name: raw.name,
      kind: raw.kind,
      tokens: validateTokens(fileName, raw.tokens),
      shiki: validateShiki(fileName, raw.shiki),
      mermaid: validateMermaid(fileName, raw.mermaid),
    };
  }
  return fail(fileName, "kind must be auto, light or dark");
}

const RAW_THEMES: ReadonlyArray<readonly [string, unknown]> = [
  ["auto", autoRaw],
  ["dracula", draculaRaw],
  ["github-dark", githubDarkRaw],
  ["github-light", githubLightRaw],
  ["gruvbox-dark", gruvboxDarkRaw],
  ["gruvbox-light", gruvboxLightRaw],
  ["nord", nordRaw],
  ["solarized-dark", solarizedDarkRaw],
  ["solarized-light", solarizedLightRaw],
];

function loadThemes(): Map<string, ResolvedTheme> {
  const validated = new Map<string, Theme>();
  for (const [fileName, raw] of RAW_THEMES) {
    const theme = validateTheme(fileName, raw);
    validated.set(theme.name, theme);
  }

  const names = [...validated.keys()].sort((a, b) => {
    if (a === "auto") return -1;
    if (b === "auto") return 1;
    return a.localeCompare(b);
  });

  const resolved = new Map<string, ResolvedTheme>();
  for (const name of names) {
    const theme = validated.get(name)!;
    if (theme.kind === "auto") {
      const light = validated.get(theme.variants.light);
      const dark = validated.get(theme.variants.dark);
      if (!light || light.kind === "auto") {
        fail(name, `unknown light variant ${theme.variants.light}`);
      }
      if (!dark || dark.kind === "auto") {
        fail(name, `unknown dark variant ${theme.variants.dark}`);
      }
      resolved.set(name, { name, kind: "auto", light, dark });
    } else {
      resolved.set(name, { name, kind: theme.kind, light: theme, dark: theme });
    }
  }
  return resolved;
}

const THEMES = loadThemes();

export const DEFAULT_THEME = "auto";

export function themeNames(): string[] {
  return [...THEMES.keys()];
}

export function hasTheme(name: string | null | undefined): boolean {
  return !!name && THEMES.has(name);
}

export function getTheme(name?: string | null): ResolvedTheme {
  return (name && THEMES.get(name)) || THEMES.get(DEFAULT_THEME)!;
}

export function shikiThemeNames(): string[] {
  const names = new Set<string>();
  for (const theme of THEMES.values()) {
    names.add(theme.light.shiki.light);
    names.add(theme.dark.shiki.dark);
  }
  return [...names];
}
