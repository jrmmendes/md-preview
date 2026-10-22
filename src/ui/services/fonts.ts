import type { FontCategory, FontInfo, FontsPayload } from "../../core/contract";
import {
  clearFontSelection,
  setFontSelection,
  type FontSelection,
} from "../prefs";
import {
  DEFAULT_FONT_STACK,
  GENERIC_FAMILIES,
  fontStack,
  safeStack,
  sanitizeFamily,
} from "./font-value";

const FONTS_URL = "/__fonts";
const GOOGLE_LINK_ID = "mdprv-font-google-css";
const GOOGLE_TIMEOUT_MS = 8000;
const MAX_STYLES = 32;

function genericCategory(family: string): FontCategory {
  switch (family) {
    case "monospace":
      return "monospace";
    case "serif":
      return "serif";
    case "cursive":
      return "script";
    case "sans-serif":
    case "system-ui":
      return "sans";
    default:
      return "unknown";
  }
}

function genericFonts(): FontInfo[] {
  return GENERIC_FAMILIES.map((family) => ({
    family,
    styles: [],
    category: genericCategory(family),
  }));
}

export function fallbackFontsPayload(): FontsPayload {
  const fonts = genericFonts();
  return {
    available: false,
    source: "fallback",
    fonts,
    generatedAt: new Date().toISOString(),
    total: fonts.length,
  };
}

function asCategory(value: unknown): FontCategory {
  return value === "sans" || value === "serif" || value === "monospace" || value === "script"
    ? value
    : "unknown";
}

function parsePayload(value: unknown): FontsPayload | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as {
    available?: unknown;
    source?: unknown;
    fonts?: unknown;
    generatedAt?: unknown;
  };
  if (!Array.isArray(candidate.fonts)) {
    return null;
  }
  const fonts: FontInfo[] = [];
  const seen = new Set<string>();
  for (const entry of candidate.fonts) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const record = entry as { family?: unknown; styles?: unknown; category?: unknown };
    const family = sanitizeFamily(record.family);
    if (!family) {
      continue;
    }
    const key = family.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const styles = Array.isArray(record.styles)
      ? record.styles
          .filter((style): style is string => typeof style === "string" && style.trim() !== "")
          .map((style) => style.trim())
          .slice(0, MAX_STYLES)
      : [];
    fonts.push({ family, styles, category: asCategory(record.category) });
  }
  return {
    available: candidate.available === true,
    source: candidate.source === "system" ? "system" : "fallback",
    fonts,
    generatedAt:
      typeof candidate.generatedAt === "string" ? candidate.generatedAt : new Date().toISOString(),
    total: fonts.length,
  };
}

let cache: FontsPayload | null = null;
let inflight: Promise<FontsPayload> | null = null;
let issued = 0;
let applied = 0;

export function fetchFonts(force = false): Promise<FontsPayload> {
  if (!force && cache) {
    return Promise.resolve(cache);
  }
  if (!force && inflight) {
    return inflight;
  }
  const sequence = ++issued;
  const url = force ? `${FONTS_URL}?refresh=1` : FONTS_URL;
  const request = (async (): Promise<FontsPayload> => {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return fallbackFontsPayload();
      }
      const payload = parsePayload(await response.json());
      if (!payload) {
        return fallbackFontsPayload();
      }
      if (!payload.available && payload.fonts.length === 0) {
        return fallbackFontsPayload();
      }
      return payload;
    } catch {
      return fallbackFontsPayload();
    }
  })();
  inflight = request;
  return request.then(
    (payload) => {
      if (sequence >= applied) {
        applied = sequence;
        cache = payload;
      }
      if (inflight === request) {
        inflight = null;
      }
      return payload;
    },
    () => {
      if (inflight === request) {
        inflight = null;
      }
      return fallbackFontsPayload();
    }
  );
}

export function applySelection(selection: FontSelection): string {
  const family = sanitizeFamily(selection.family);
  const stack = family ? safeStack(family, selection.stack) : DEFAULT_FONT_STACK;
  document.documentElement.style.setProperty("--mdprv-font", stack);
  return stack;
}

export function removeGoogleLink(): void {
  document.getElementById(GOOGLE_LINK_ID)?.remove();
}

export function resetSelection(): void {
  document.documentElement.style.removeProperty("--mdprv-font");
  document.documentElement.removeAttribute("data-font-missing");
  removeGoogleLink();
  clearFontSelection();
}

function googleHref(family: string): string {
  return `${FONTS_URL}/google?family=${encodeURIComponent(family)}`;
}

export async function loadGoogleFamily(family: string): Promise<FontSelection> {
  const safe = sanitizeFamily(family);
  if (!safe) {
    throw new Error("invalid-family");
  }
  const href = googleHref(safe);
  const existing = document.getElementById(GOOGLE_LINK_ID);
  if (
    existing &&
    existing.getAttribute("href") === href &&
    !document.documentElement.hasAttribute("data-font-missing")
  ) {
    const current = setFontSelection({ family: safe, source: "google", stack: fontStack(safe) });
    if (current) {
      applySelection(current);
      return current;
    }
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer = 0;
    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      link.removeEventListener("load", onLoad);
      link.removeEventListener("error", onError);
      if (error) {
        link.remove();
        reject(error);
        return;
      }
      resolve();
    };
    const onLoad = (): void => finish();
    const onError = (): void => finish(new Error("google-font-failed"));
    timer = window.setTimeout(() => finish(new Error("google-font-timeout")), GOOGLE_TIMEOUT_MS);
    link.addEventListener("load", onLoad);
    link.addEventListener("error", onError);
    (document.head ?? document.documentElement).appendChild(link);
  });

  existing?.remove();
  link.id = GOOGLE_LINK_ID;
  document.documentElement.removeAttribute("data-font-missing");
  const selection = setFontSelection({ family: safe, source: "google", stack: fontStack(safe) });
  if (!selection) {
    link.remove();
    throw new Error("invalid-family");
  }
  applySelection(selection);
  return selection;
}
