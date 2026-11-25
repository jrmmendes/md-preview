/**
 * Public theme catalog shared by the page payload and the import endpoints.
 *
 * The modal uses the same shape for both sources, so an imported color theme
 * can be appended to the grid and selected without a reload.
 */
import type { ThemeCatalogEntry, ThemeCatalogPreset } from "../contract";
import { sanitizeMermaidName } from "./mermaid-index";
import type { ThemeStore } from "./store";
import type { FixedTheme, ResolvedTheme } from "./types";

function catalogPreset(theme: FixedTheme): ThemeCatalogPreset {
  return {
    loader: theme.loader,
    font: { family: theme.typography.family, stack: theme.typography.stack },
    shiki: { light: theme.shiki.light, dark: theme.shiki.dark },
    mermaid: sanitizeMermaidName(theme.mermaid.theme),
  };
}

export function themeCatalogEntry(
  theme: ResolvedTheme,
  source: "builtin" | "user" = "builtin"
): ThemeCatalogEntry {
  return {
    name: theme.name,
    kind: theme.kind,
    source,
    swatch: {
      background: theme.light.colors.background,
      text: theme.light.colors.text,
      accent: theme.light.colors.accent,
    },
    presets: {
      light: catalogPreset(theme.light),
      dark: catalogPreset(theme.dark),
    },
  };
}

/** Builtin + user themes, in store order (`auto` first). */
export function themeCatalog(store: ThemeStore): ThemeCatalogEntry[] {
  const sources = new Map(store.list().map((item) => [item.name, item.source]));
  return store
    .names()
    .map((name) =>
      themeCatalogEntry(store.get(name), sources.get(name) === "user" ? "user" : "builtin")
    );
}
