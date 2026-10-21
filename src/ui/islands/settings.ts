import {
  getFont,
  getZoomSensitivity,
  setFont,
  setLoaderPending,
  setTheme,
  setZoomSensitivity,
} from "../prefs";
import * as loader from "../services/loader";

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
    setLoaderPending(true);
    setTheme(value);
    window.setTimeout(() => {
      window.location.href =
        window.location.pathname + (value === "auto" ? "" : "?theme=" + encodeURIComponent(value));
    }, 80);
  });
}

function setupFont(): void {
  const root = document.documentElement;
  const input = document.getElementById("mdprv-font") as HTMLInputElement | null;
  const list = document.getElementById("mdprv-font-list") as HTMLDataListElement | null;
  const loadButton = document.getElementById("mdprv-font-load");
  const resetButton = document.getElementById("mdprv-font-reset");

  function apply(value: string): void {
    const font = (value || "").trim();
    if (font) {
      root.style.setProperty("--mdprv-font", font);
    } else {
      root.style.removeProperty("--mdprv-font");
    }
  }

  const initial = getFont();
  if (initial) {
    apply(initial);
  }
  if (input) {
    if (initial) {
      input.value = initial;
    }
    function onChange(): void {
      if (!input) {
        return;
      }
      apply(input.value);
      setFont(input.value);
    }
    input.addEventListener("input", onChange);
    input.addEventListener("change", () => {
      onChange();
      loader.settle();
    });
  }

  resetButton?.addEventListener("click", () => {
    apply("");
    setFont("");
    if (input) {
      input.value = "";
    }
    loader.settle();
  });

  loadButton?.addEventListener("click", () => {
    const query = window.queryLocalFonts;
    if (typeof query !== "function") {
      loadButton.setAttribute("title", "Local font access is not supported in this browser");
      return;
    }
    query.call(window).then((fonts) => {
      if (!list || !fonts) {
        return;
      }
      const seen = new Set<string>();
      const fragment = document.createDocumentFragment();
      fonts.forEach((font) => {
        const name = font && font.family;
        if (!name || seen.has(name)) {
          return;
        }
        seen.add(name);
        const option = document.createElement("option");
        option.value = name;
        fragment.appendChild(option);
      });
      list.textContent = "";
      list.appendChild(fragment);
    }).catch(() => {
      /* permission denied or API failure: ignore */
    });
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
  setupFont();
  setupZoom();
}
