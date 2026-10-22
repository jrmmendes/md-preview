import {
  type LoaderIntent,
  intentMatches,
  parseLoaderIntent,
  serializeLoaderIntent,
} from "./services/loader-intent";
import { fontStack, safeStack, sanitizeFamily } from "./services/font-value";

const YEAR_SECONDS = 60 * 60 * 24 * 365;

const FONT_VERSION = 1;

export type FontSource = "local" | "google";

export interface FontSelection {
  family: string;
  source: FontSource;
  stack: string;
}

export interface FontSelectionInput {
  family: string;
  source?: FontSource;
  stack?: string;
}

const KEYS = {
  width: "mdprv_width",
  loader: "mdprv_loader",
  font: "mdprv_font",
  zoom: "mdprv_zoom_sensitivity",
  left: "mdprv_left_collapsed",
  right: "mdprv_right_collapsed",
  loaderIntent: "mdprv_loader_pending",
} as const;

const LEGACY_KEYS = {
  left: "mdprv-left-collapsed",
  right: "mdprv-right-collapsed",
} as const;

const THEME_COOKIE = "mdprv_theme";

export type CollapsedSide = "left" | "right";

const memory = new Map<string, string>();
const sessionMemory = new Map<string, string>();
let migrated = false;

function localGet(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    if (value !== null) {
      return value;
    }
  } catch {
    /* storage blocked: fall back to memory */
  }
  return memory.get(key) ?? null;
}

function localSet(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked: keep the in-memory value */
  }
}

function localRemove(key: string): void {
  memory.delete(key);
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function sessionGet(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key);
    if (value !== null) {
      return value;
    }
  } catch {
    /* storage blocked: fall back to memory */
  }
  return sessionMemory.get(key) ?? null;
}

function sessionSet(key: string, value: string): void {
  sessionMemory.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: keep the in-memory value */
  }
}

function sessionRemove(key: string): void {
  sessionMemory.delete(key);
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function cookieGet(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) {
      continue;
    }
    if (part.slice(0, index).trim() !== name) {
      continue;
    }
    const raw = part.slice(index + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function cookieSet(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${YEAR_SECONDS};SameSite=Lax`;
}

function cookieDelete(name: string): void {
  document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
}

function migrateSide(side: CollapsedSide, legacyKey: string, key: string): void {
  const current = localGet(key);
  if (current !== null) {
    localRemove(legacyKey);
    cookieDelete(legacyKey);
    return;
  }
  const raw = localGet(legacyKey) ?? cookieGet(legacyKey);
  if (raw === "1" || raw === "true") {
    localSet(key, "1");
  } else if (raw === "0" || raw === "false") {
    localSet(key, "0");
  }
  localRemove(legacyKey);
  cookieDelete(legacyKey);
}

function migrateCollapsed(): void {
  if (migrated) {
    return;
  }
  migrated = true;
  migrateSide("left", LEGACY_KEYS.left, KEYS.left);
  migrateSide("right", LEGACY_KEYS.right, KEYS.right);
}

export function getTheme(): string | null {
  return cookieGet(THEME_COOKIE);
}

export function setTheme(name: string): void {
  cookieSet(THEME_COOKIE, name);
}

export function getWidth(): number | null {
  const raw = localGet(KEYS.width);
  if (raw === null || raw === "") {
    return null;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

export function setWidth(width: number): void {
  localSet(KEYS.width, String(Math.round(width)));
}

export function getLoader(): string | null {
  return localGet(KEYS.loader);
}

export function setLoader(name: string): void {
  localSet(KEYS.loader, name);
}

function serializeFontSelection(selection: FontSelection): string {
  return JSON.stringify({
    v: FONT_VERSION,
    family: selection.family,
    source: selection.source,
    stack: selection.stack,
  });
}

function normalizeSelection(value: unknown): FontSelection | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    v?: unknown;
    family?: unknown;
    source?: unknown;
    stack?: unknown;
  };
  if (candidate.v !== FONT_VERSION) {
    return null;
  }
  const family = sanitizeFamily(candidate.family);
  if (!family) {
    return null;
  }
  const source: FontSource = candidate.source === "google" ? "google" : "local";
  return { family, source, stack: safeStack(family, candidate.stack) };
}

export function getFontSelection(): FontSelection | null {
  const raw = localGet(KEYS.font);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const text = raw.trim();
  if (!text.startsWith("{")) {
    const family = sanitizeFamily(text);
    if (!family) {
      return null;
    }
    const migrated: FontSelection = { family, source: "local", stack: fontStack(family) };
    localSet(KEYS.font, serializeFontSelection(migrated));
    return migrated;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const selection = normalizeSelection(value);
  if (selection && serializeFontSelection(selection) !== text) {
    localSet(KEYS.font, serializeFontSelection(selection));
  }
  return selection;
}

export function setFontSelection(input: FontSelectionInput): FontSelection | null {
  const family = sanitizeFamily(input.family);
  if (!family) {
    return null;
  }
  const source: FontSource = input.source === "google" ? "google" : "local";
  const selection: FontSelection = {
    family,
    source,
    stack: safeStack(family, input.stack),
  };
  localSet(KEYS.font, serializeFontSelection(selection));
  return selection;
}

export function clearFontSelection(): void {
  localRemove(KEYS.font);
}

export function getFont(): string {
  return getFontSelection()?.family ?? "";
}

export function setFont(font: string): void {
  const family = sanitizeFamily(font);
  if (!family) {
    clearFontSelection();
    return;
  }
  setFontSelection({ family, source: "local", stack: fontStack(family) });
}

export function getZoomSensitivity(): number | null {
  const raw = localGet(KEYS.zoom);
  if (raw === null || raw === "") {
    return null;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

export function setZoomSensitivity(value: number): void {
  localSet(KEYS.zoom, String(value));
}

export function getCollapsed(side: CollapsedSide): boolean {
  migrateCollapsed();
  const raw = localGet(side === "left" ? KEYS.left : KEYS.right);
  return raw === "1" || raw === "true";
}

export function setCollapsed(side: CollapsedSide, collapsed: boolean): void {
  localSet(side === "left" ? KEYS.left : KEYS.right, collapsed ? "1" : "0");
}

function currentPath(): string {
  try {
    return window.location.pathname;
  } catch {
    return "/";
  }
}

export function readLoaderIntent(now: number = Date.now()): LoaderIntent | null {
  return parseLoaderIntent(sessionGet(KEYS.loaderIntent), now, currentPath());
}

export function writeLoaderIntent(path: string, now: number = Date.now()): void {
  sessionSet(KEYS.loaderIntent, serializeLoaderIntent(path, now));
}

export function consumeLoaderIntent(path: string, now: number = Date.now()): boolean {
  const intent = readLoaderIntent(now);
  sessionRemove(KEYS.loaderIntent);
  return intentMatches(intent, path);
}
