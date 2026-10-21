import { getLoader } from "../prefs";

export const LOADERS = ["classic", "dots", "bars", "ring", "pulse", "braille"] as const;

export type LoaderName = (typeof LOADERS)[number];

let overlay: HTMLElement | null = null;
let spinner: HTMLElement | null = null;
let select: HTMLSelectElement | null = null;
let currentName: LoaderName = "classic";

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

export function show(): void {
  overlay?.classList.add("mdprv-loader-active");
}

export function hide(): void {
  overlay?.classList.remove("mdprv-loader-active");
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

export function flash(ms: number): void {
  show();
  window.setTimeout(hide, ms);
}

export function settle(): void {
  show();
  const start = Date.now();
  const MIN = 180;
  let finished = false;

  function finish(): void {
    if (finished) {
      return;
    }
    finished = true;
    const wait = Math.max(0, MIN - (Date.now() - start));
    window.setTimeout(() => {
      window.requestAnimationFrame(hide);
    }, wait);
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(finish, finish);
    window.setTimeout(finish, 600);
  } else {
    window.setTimeout(finish, 250);
  }
}

export function current(): LoaderName {
  return currentName;
}

export function init(): void {
  refs();
  const stored = getLoader();
  set(isLoaderName(stored) ? stored : defaultName());
}
