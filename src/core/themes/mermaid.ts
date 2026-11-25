import type {
  BuiltinMermaidThemeName,
  MermaidThemeName,
} from "./constants";
import {
  getMermaidThemeStore,
  isBuiltinMermaidThemeName,
} from "./mermaid-index";
import type { MermaidCustomTheme } from "./mermaid-custom";
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

export interface MermaidResolveDeps {
  /** Override used by tests; defaults to the active custom store. */
  getCustom?: (name: string) => MermaidCustomTheme | undefined;
  warn?: (message: string) => void;
}

const warnedMissing = new Set<string>();

/** Test helper: forget which missing custom themes were already reported. */
export function resetMermaidWarnings(): void {
  warnedMissing.clear();
}

function defaultWarn(message: string): void {
  try {
    process.stderr.write(`md-preview: ${message}\n`);
  } catch {
    /* no stderr */
  }
}

function warnMissing(name: string, deps: MermaidResolveDeps): void {
  if (warnedMissing.has(name)) {
    return;
  }
  warnedMissing.add(name);
  (deps.warn ?? defaultWarn)(
    `Mermaid theme ${name} is not builtin and was not imported on this machine; falling back to default`
  );
}

function builtinConfig(
  theme: FixedTheme,
  name: BuiltinMermaidThemeName
): MermaidConfig {
  return {
    theme: name,
    themeVariables: {
      ...defaultMermaidVariables(theme.colors),
      ...theme.mermaid.overrides,
    },
  };
}

/**
 * Resolves the theme name stored in `mermaid.theme`. Builtins keep the derived
 * palette + overrides contract; an imported custom theme replaces both with its
 * own base theme and variables. A missing custom theme falls back to the
 * builtin `default` and warns once per process.
 */
export function mermaidConfig(
  theme: FixedTheme,
  deps: MermaidResolveDeps = {}
): MermaidConfig {
  const name = theme.mermaid.theme;
  if (typeof name === "string" && isBuiltinMermaidThemeName(name)) {
    return builtinConfig(theme, name);
  }
  const getCustom = deps.getCustom ?? ((value: string) => getMermaidThemeStore().get(value));
  const custom = getCustom(name);
  if (custom) {
    return {
      theme: custom.theme,
      themeVariables: { ...custom.variables },
    };
  }
  warnMissing(name, deps);
  return builtinConfig(theme, "default");
}

export function mermaidPayload(
  theme: ResolvedTheme,
  deps: MermaidResolveDeps = {}
): MermaidPayload {
  return {
    light: mermaidConfig(theme.light, deps),
    dark: mermaidConfig(theme.dark, deps),
  };
}
