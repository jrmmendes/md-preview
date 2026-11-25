/**
 * Storage das personalizações de Shiki/Mermaid.
 *
 * `localStorage` é a fonte da verdade (`mdprv_shiki`/`mdprv_mermaid`); o cookie
 * `mdprv_prefs` é só o transporte até o renderizador do daemon e carrega
 * exclusivamente esses dois grupos.
 */
import {
  parseThemePrefs,
  serializeThemePrefs,
  THEME_PREFS_COOKIE,
  THEME_PREFS_MERMAID_KEY,
  THEME_PREFS_SHIKI_KEY,
  type ThemePrefs,
} from "../../shared/theme-prefs";
import type { MermaidThemeName, ShikiThemeName } from "../../core/themes/constants";

export const SHIKI_STORAGE_KEY = THEME_PREFS_SHIKI_KEY;
export const MERMAID_STORAGE_KEY = THEME_PREFS_MERMAID_KEY;
export const PREFS_COOKIE = THEME_PREFS_COOKIE;

export type { ThemePrefs };

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function localGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

function localRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function cookieSet(value: string): void {
  try {
    document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function cookieDelete(): void {
  try {
    document.cookie = `${PREFS_COOKIE}=;path=/;max-age=0;SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

export interface ShikiPrefs {
  light: ShikiThemeName;
  dark: ShikiThemeName;
}

export interface MermaidPrefs {
  light: MermaidThemeName;
  dark: MermaidThemeName;
}

function parseStored(raw: string | null): ThemePrefs | null {
  return parseThemePrefs(raw);
}

export function readShikiPrefs(): ShikiPrefs | null {
  const prefs = parseStored(localGet(SHIKI_STORAGE_KEY));
  return prefs?.shiki ?? null;
}

export function readMermaidPrefs(): MermaidPrefs | null {
  const prefs = parseStored(localGet(MERMAID_STORAGE_KEY));
  return prefs?.mermaid ?? null;
}

/** Rebuilds the cookie from both storages; deletes it when nothing is set. */
export function syncPrefsCookie(): void {
  const shiki = readShikiPrefs();
  const mermaid = readMermaidPrefs();
  if (!shiki && !mermaid) {
    cookieDelete();
    return;
  }
  const encoded = serializeThemePrefs({
    v: 1,
    ...(shiki ? { shiki: { light: shiki.light, dark: shiki.dark } } : {}),
    ...(mermaid ? { mermaid: { light: mermaid.light, dark: mermaid.dark } } : {}),
  });
  if (encoded) {
    cookieSet(encoded);
  } else {
    cookieDelete();
  }
}

export function writeShikiPrefs(value: ShikiPrefs | null): void {
  if (!value) {
    localRemove(SHIKI_STORAGE_KEY);
  } else {
    const encoded = serializeThemePrefs({
      v: 1,
      shiki: { light: value.light, dark: value.dark },
    });
    if (encoded) {
      localSet(SHIKI_STORAGE_KEY, encoded);
    }
  }
  syncPrefsCookie();
}

export function writeMermaidPrefs(value: MermaidPrefs | null): void {
  if (!value) {
    localRemove(MERMAID_STORAGE_KEY);
  } else {
    const encoded = serializeThemePrefs({
      v: 1,
      mermaid: { light: value.light, dark: value.dark },
    });
    if (encoded) {
      localSet(MERMAID_STORAGE_KEY, encoded);
    }
  }
  syncPrefsCookie();
}

export function clearThemePrefs(): void {
  localRemove(SHIKI_STORAGE_KEY);
  localRemove(MERMAID_STORAGE_KEY);
  cookieDelete();
}
