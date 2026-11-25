import type { ThemePrefs } from "../../shared/theme-prefs";
import type { MermaidThemeName, ShikiThemeName } from "./constants";
import { isKnownShikiTheme } from "./shiki-index";
import type { FixedTheme, ResolvedTheme } from "./types";

function withPrefs(
  theme: FixedTheme,
  shiki: { light: ShikiThemeName; dark: ShikiThemeName } | undefined,
  mermaidTheme: MermaidThemeName | undefined
): FixedTheme {
  const effectiveShiki = shiki
    ? {
        light: isKnownShikiTheme(shiki.light) ? shiki.light : theme.shiki.light,
        dark: isKnownShikiTheme(shiki.dark) ? shiki.dark : theme.shiki.dark,
      }
    : undefined;
  if (!effectiveShiki && !mermaidTheme) {
    return theme;
  }
  return {
    ...theme,
    // Colors still drive the Mermaid variables; only the named themes change.
    colors: theme.colors,
    shiki: effectiveShiki ?? theme.shiki,
    mermaid: mermaidTheme ? { ...theme.mermaid, theme: mermaidTheme } : theme.mermaid,
  };
}

/**
 * Returns a copy of the resolved theme with the per-browser Shiki/Mermaid
 * preferences applied. The input is never mutated, so the theme store and
 * other requests stay isolated.
 *
 * `auto` themes carry one preference per effective scheme; fixed themes use
 * the side that matches their `kind` (the only scheme they ever render).
 */
export function applyThemeOverrides(
  theme: ResolvedTheme,
  prefs: ThemePrefs | null
): ResolvedTheme {
  if (!prefs || (!prefs.shiki && !prefs.mermaid)) {
    return theme;
  }
  const shiki = prefs.shiki;
  if (theme.kind === "auto") {
    return {
      ...theme,
      light: withPrefs(theme.light, shiki, prefs.mermaid?.light),
      dark: withPrefs(theme.dark, shiki, prefs.mermaid?.dark),
    };
  }
  const side = theme.kind;
  const mermaidTheme = prefs.mermaid?.[side];
  return {
    ...theme,
    light: withPrefs(theme.light, shiki, mermaidTheme),
    dark: withPrefs(theme.dark, shiki, mermaidTheme),
  };
}
