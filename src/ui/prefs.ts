const YEAR_SECONDS = 60 * 60 * 24 * 365;

const KEYS = {
  width: "mdprv_width",
  loader: "mdprv_loader",
  font: "mdprv_font",
  zoom: "mdprv_zoom_sensitivity",
  left: "mdprv_left_collapsed",
  right: "mdprv_right_collapsed",
  loaderPending: "mdprv_loader_pending",
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

export function getFont(): string {
  return localGet(KEYS.font) ?? "";
}

export function setFont(font: string): void {
  localSet(KEYS.font, font.trim());
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

export function getLoaderPending(): boolean {
  return sessionGet(KEYS.loaderPending) === "1";
}

export function setLoaderPending(pending: boolean): void {
  if (pending) {
    sessionSet(KEYS.loaderPending, "1");
  } else {
    sessionRemove(KEYS.loaderPending);
  }
}
