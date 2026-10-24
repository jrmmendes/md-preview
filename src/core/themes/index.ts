import { SHIKI_THEME_NAMES } from "./constants";
import { createThemeStore, type ThemeStore } from "./store";
import type { ResolvedTheme, ThemeInfo } from "./types";

let active: ThemeStore | null = null;

export function getThemeStore(): ThemeStore {
  if (!active) {
    active = createThemeStore({ dir: null, watch: false });
  }
  return active;
}

export function setThemeStore(store: ThemeStore | null): void {
  active = store;
}

export function themeNames(): string[] {
  return getThemeStore().names();
}

export function hasTheme(name: string | null | undefined): boolean {
  return getThemeStore().has(name);
}

export function getTheme(name?: string | null): ResolvedTheme {
  return getThemeStore().get(name);
}

export function listThemes(): ThemeInfo[] {
  return getThemeStore().list();
}

export function themeErrors() {
  return getThemeStore().errors();
}

export function shikiThemeNames(): string[] {
  return [...SHIKI_THEME_NAMES];
}

export type { ThemeStore };
