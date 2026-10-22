import { getLoader } from "../prefs";
import { createLoaderState, type LoaderState } from "./loader-state";

export const LOADERS = ["classic", "dots", "bars", "ring", "pulse", "braille"] as const;

export type LoaderName = (typeof LOADERS)[number];

let overlay: HTMLElement | null = null;
let spinner: HTMLElement | null = null;
let select: HTMLSelectElement | null = null;
let currentName: LoaderName = "classic";
let state: LoaderState | null = null;
let watchingPages = false;

export function isLoaderName(value: unknown): value is LoaderName {
  return typeof value === "string" && (LOADERS as readonly string[]).includes(value);
}

function defaultName(): LoaderName {
  const attr = document.documentElement.getAttribute("data-loader");
  return isLoaderName(attr) ? attr : "classic";
}

function refs(): void {
  overlay = document.getElementById("mdprv-loader-overlay");
  spinner = document.getElementById("mdprv-loader-spinner");
  select = document.getElementById("mdprv-loader") as HTMLSelectElement | null;
}

function applyVisible(visible: boolean): void {
  if (!overlay) {
    refs();
  }
  const root = document.documentElement;
  if (visible) {
    overlay?.classList.add("mdprv-loader-active");
    root.setAttribute("data-loading", "1");
  } else {
    overlay?.classList.remove("mdprv-loader-active");
    root.removeAttribute("data-loading");
  }
}

function machine(): LoaderState {
  if (!state) {
    state = createLoaderState({ onChange: applyVisible });
  }
  return state;
}

export function begin(): void {
  machine().begin();
}

export function show(): void {
  begin();
}

export function hide(): void {
  machine().hide();
  applyVisible(false);
}

export function preview(ms: number): void {
  machine().preview(ms);
}

export function settle(): void {
  const loader = machine();
  loader.begin();
  loader.markLoaded();
  const fonts = document.fonts;
  if (fonts && fonts.ready) {
    fonts.ready.then(
      () => loader.markFontsReady(),
      () => loader.markFontsReady()
    );
  } else {
    loader.markFontsReady();
  }
}

export function set(name: string): void {
  const next = isLoaderName(name) ? name : defaultName();
  currentName = next;
  if (spinner) {
    spinner.className = "mdprv-loader mdprv-loader--" + next;
  }
  if (select && select.value !== next) {
    select.value = next;
  }
  document.documentElement.setAttribute("data-loader", next);
}

export function current(): LoaderName {
  return currentName;
}

export function init(): void {
  refs();
  const stored = getLoader();
  set(isLoaderName(stored) ? stored : defaultName());
  if (watchingPages) {
    return;
  }
  watchingPages = true;
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      hide();
    }
  });
}
