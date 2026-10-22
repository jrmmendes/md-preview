import { getZoomSensitivity, setTheme, setZoomSensitivity, writeLoaderIntent } from "../prefs";
import * as loader from "../services/loader";
import { initFontPicker } from "./font-picker";

function clampZoom(value: number): number {
  let zoom = value;
  if (!Number.isFinite(zoom) || zoom <= 1) {
    zoom = 1.1;
  }
  if (zoom > 3) {
    zoom = 3;
  }
  return zoom;
}

function setupPanel(): void {
  const button = document.getElementById("mdprv-settings-toggle");
  const panel = document.getElementById("mdprv-settings");
  if (!button || !panel) {
    return;
  }

  function sync(): void {
    button?.setAttribute("aria-expanded", panel?.hasAttribute("hidden") ? "false" : "true");
  }

  button.addEventListener("click", () => {
    if (panel.hasAttribute("hidden")) {
      panel.removeAttribute("hidden");
    } else {
      panel.setAttribute("hidden", "");
    }
    sync();
  });

  sync();
}

function setupTheme(): void {
  const select = document.getElementById("mdprv-theme") as HTMLSelectElement | null;
  if (!select) {
    return;
  }

  select.addEventListener("change", () => {
    const value = select.value;
    loader.show();
    writeLoaderIntent(window.location.pathname);
    setTheme(value);
    window.setTimeout(() => {
      window.location.href =
        window.location.pathname + (value === "auto" ? "" : "?theme=" + encodeURIComponent(value));
    }, 80);
  });
}

function setupZoom(): void {
  const input = document.getElementById("mdprv-zoom-sens") as HTMLInputElement | null;
  if (!input) {
    return;
  }

  function current(): number {
    const stored = getZoomSensitivity();
    if (stored !== null) {
      return clampZoom(stored);
    }
    const attr = Number.parseFloat(document.documentElement.getAttribute("data-zoom-sensitivity") ?? "");
    return Number.isFinite(attr) ? clampZoom(attr) : 1.1;
  }

  input.value = String(current());

  function commit(): void {
    if (!input) {
      return;
    }
    let value = clampZoom(Number.parseFloat(input.value));
    value = Math.round(value * 100) / 100;
    input.value = String(value);
    setZoomSensitivity(value);
  }

  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
}

export function initSettings(): void {
  setupPanel();
  setupTheme();
  initFontPicker();
  setupZoom();
}
