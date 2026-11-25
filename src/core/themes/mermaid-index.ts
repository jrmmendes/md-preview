import type { MermaidThemeEntry } from "../contract";
import {
  MERMAID_THEMES,
  type BuiltinMermaidThemeName,
  type MermaidThemeName,
} from "./constants";
import { createMermaidThemeStore, type MermaidThemeStore } from "./mermaid-store";

let active: MermaidThemeStore | null = null;

export function getMermaidThemeStore(): MermaidThemeStore {
  if (!active) {
    active = createMermaidThemeStore({ dir: null, watch: false });
  }
  return active;
}

export function setMermaidThemeStore(store: MermaidThemeStore | null): void {
  active = store;
}

const BUILTIN_LABELS: Record<BuiltinMermaidThemeName, string> = {
  default: "Default",
  neutral: "Neutral",
  dark: "Dark",
  forest: "Forest",
  base: "Base",
};

const BUILTIN_ENTRIES: readonly MermaidThemeEntry[] = MERMAID_THEMES.map((name) => ({
  name,
  label: BUILTIN_LABELS[name],
  source: "builtin" as const,
  theme: name,
  variables: {},
}));

export function isBuiltinMermaidThemeName(name: string): name is BuiltinMermaidThemeName {
  return (MERMAID_THEMES as readonly string[]).includes(name);
}

/** Builtins are always known; custom slugs depend on the active store. */
export function isKnownMermaidTheme(name: string): boolean {
  return isBuiltinMermaidThemeName(name) || getMermaidThemeStore().has(name);
}

/**
 * Effective public name for one slot. A missing custom theme falls back to the
 * builtin `default`, matching the render-time warning path.
 */
export function sanitizeMermaidName(
  name: MermaidThemeName,
  warn?: (message: string) => void
): MermaidThemeName {
  if (isKnownMermaidTheme(name)) {
    return name;
  }
  if (name !== "" && name !== "default") {
    warn?.(`mermaid theme ${name} is not available; falling back to default`);
  }
  return "default";
}

/** Catalog used by the modal: builtins first, then imported themes. */
export function mermaidThemeEntries(): MermaidThemeEntry[] {
  return [
    ...BUILTIN_ENTRIES.map((entry) => ({ ...entry, variables: { ...entry.variables } })),
    ...getMermaidThemeStore().list().map((entry) => ({
      name: entry.name,
      label: entry.label,
      source: entry.source,
      theme: entry.theme,
      variables: { ...entry.variables },
    })),
  ];
}

export type { MermaidThemeStore };
