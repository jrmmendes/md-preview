import type { ShikiThemeEntry } from "../contract";
import { BUILTIN_SHIKI_THEMES } from "../markdown/shiki-builtins";
import { shikiLabel } from "./shiki-custom";
import {
  createShikiThemeStore,
  type ShikiThemeStore,
} from "./shiki-store";

let active: ShikiThemeStore | null = null;

export function getShikiThemeStore(): ShikiThemeStore {
  if (!active) {
    active = createShikiThemeStore({ dir: null, watch: false });
  }
  return active;
}

export function setShikiThemeStore(store: ShikiThemeStore | null): void {
  active = store;
}

const BUILTIN_ENTRIES: readonly ShikiThemeEntry[] = BUILTIN_SHIKI_THEMES.map((theme) => ({
  name: theme.name,
  label: shikiLabel(theme.name),
  kind: theme.kind,
  source: "builtin" as const,
})).sort((a, b) => a.name.localeCompare(b.name));

/** Builtins are always known; custom slugs depend on the active store. */
export function isKnownShikiTheme(name: string): boolean {
  if (!name || name === "auto") {
    return false;
  }
  return (
    BUILTIN_SHIKI_THEMES.some((theme) => theme.name === name) ||
    getShikiThemeStore().has(name)
  );
}

/** Effective public name for one slot, with the card fallback. */
export function sanitizeShikiName(
  name: string,
  face: "light" | "dark",
  warn?: (message: string) => void
): string {
  if (isKnownShikiTheme(name)) {
    return name;
  }
  if (name !== "" && name !== "auto") {
    warn?.(
      `Shiki theme ${name} is not builtin and was not imported on this machine; falling back to ${face}`
    );
  }
  return face === "light" ? "github-light" : "github-dark";
}

/** Catalog used by the modal: builtins alphabetically, then custom themes. */
export function shikiThemeEntries(): ShikiThemeEntry[] {
  return [...BUILTIN_ENTRIES, ...getShikiThemeStore().list()];
}

export type { ShikiThemeStore };
