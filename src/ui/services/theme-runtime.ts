/**
 * Aplicação ao vivo das personalizações de aparência.
 *
 * Cores/raios/tipografia/layout vêm de `/__theme-css`; esquema é o atributo
 * `data-scheme`; fonte e loader são aplicados direto no documento. Shiki e
 * Mermaid não passam por aqui: eles dependem de um reload único ao fechar.
 */
import type { LoaderName } from "../../core/loader";
import type { FontValue, Scheme } from "../islands/settings/catalog";
import { applySelection, removeGoogleLink } from "./fonts";
import * as loader from "./loader";

const THEME_STYLE_ID = "mdprv-theme-css";
const THEME_CSS_URL = "/__theme-css";

let dirtyRender = false;

export function prefersDark(): boolean {
  try {
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  } catch {
    return false;
  }
}

export function schemeForKind(kind: "auto" | "light" | "dark"): Scheme {
  return kind === "auto" ? (prefersDark() ? "dark" : "light") : kind;
}

export function applyScheme(scheme: Scheme): void {
  document.documentElement.setAttribute("data-scheme", scheme);
}

export function applyThemeName(name: string, scheme: Scheme): void {
  document.documentElement.setAttribute("data-theme", name);
  applyScheme(scheme);
}

export async function fetchThemeCss(name: string): Promise<string | null> {
  try {
    const response = await fetch(`${THEME_CSS_URL}?name=${encodeURIComponent(name)}`, {
      headers: { accept: "text/css" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

export function applyThemeCss(css: string): void {
  const style = document.getElementById(THEME_STYLE_ID);
  if (style) {
    style.textContent = css;
  }
}

/** Applies a custom font live; `null` restores the theme stack. */
export function applyFontValue(value: FontValue | null): void {
  const root = document.documentElement;
  if (!value) {
    root.style.removeProperty("--mdprv-font");
    root.removeAttribute("data-font-missing");
    removeGoogleLink();
    return;
  }
  applySelection({ family: value.family, source: value.source, stack: value.stack });
}

/** Applies a loader preset live (attribute + spinner class). */
export function applyLoaderValue(name: LoaderName): void {
  loader.set(name);
}

export function markDirtyRender(): void {
  dirtyRender = true;
}

export function isDirtyRender(): boolean {
  return dirtyRender;
}

export function clearDirtyRender(): void {
  dirtyRender = false;
}

/** True when the tab shows a document (not the "No document open" state). */
export function hasDocumentOpen(): boolean {
  if (document.documentElement.classList.contains("mdprv-closed")) {
    return false;
  }
  const closed = document.getElementById("mdprv-closed");
  return !(closed instanceof HTMLElement && !closed.hidden);
}
