import { writeLoaderIntent } from "../prefs";
import { on } from "../services/events";
import {
  DEFAULT_ROUTE,
  parseSettingsRouteHash,
  parseSettingsRouteString,
  settingsRouteString,
} from "./settings/routes";

const SETTINGS_OPEN_KEY = "mdprv_settings_open";
const SETTINGS_LAST_ROUTE_KEY = "mdprv_settings_last_route";

function settingsOpen(): boolean {
  return document.body.classList.contains("mdprv-settings-open");
}

/** Preserve the open modal route across a forced reload (SSE/file change). */
function rememberSettings(): void {
  if (!settingsOpen()) {
    return;
  }
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(SETTINGS_LAST_ROUTE_KEY);
  } catch {
    stored = null;
  }
  const route =
    parseSettingsRouteHash(location.hash) ??
    parseSettingsRouteString(stored) ??
    DEFAULT_ROUTE;
  try {
    window.sessionStorage.setItem(SETTINGS_OPEN_KEY, settingsRouteString(route));
  } catch {
    /* storage blocked */
  }
}

function reload(): void {
  rememberSettings();
  writeLoaderIntent(location.pathname);
  location.reload();
}

/** `auto` follows its github variants; a fixed theme only reacts to itself. */
function themeChanged(active: string, changed: string[]): boolean {
  if (active === "auto") {
    return (
      changed.includes("auto") ||
      changed.includes("github-light") ||
      changed.includes("github-dark")
    );
  }
  return changed.includes(active);
}

export function initLiveReload(): void {
  let slug = location.pathname.slice(1);
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* keep the raw path */
  }

  let ready = false;
  let currentVersion: number | null = null;

  on("snapshot", (data) => {
    const version = data.versions[slug];
    currentVersion = typeof version === "number" ? version : null;
    ready = true;
  });

  on("themes", (data) => {
    const active = document.documentElement.getAttribute("data-theme") ?? "auto";
    if (!themeChanged(active, data.changed)) {
      return;
    }
    reload();
  });

  on("shiki-themes", (data) => {
    const root = document.documentElement;
    const active = [root.dataset.shikiLight, root.dataset.shikiDark].filter(
      (name): name is string => typeof name === "string" && name !== ""
    );
    const changed = Array.isArray(data.changed) ? data.changed : [];
    if (!changed.some((name) => active.includes(name))) {
      return;
    }
    reload();
  });

  on("mermaid-themes", (data) => {
    const root = document.documentElement;
    const active = [root.dataset.mermaidLight, root.dataset.mermaidDark].filter(
      (name): name is string => typeof name === "string" && name !== ""
    );
    const changed = Array.isArray(data.changed) ? data.changed : [];
    if (!changed.some((name) => active.includes(name))) {
      return;
    }
    reload();
  });

  on("emojis", (data) => {
    const active = document.documentElement.getAttribute("data-emoji") ?? "";
    const changed = Array.isArray(data.changed) ? data.changed : [];
    // Only an edit/removal of the effective pack changes the rendered HTML;
    // the settings catalog itself updates in place in the modal island.
    if (active === "" || !changed.includes(active)) {
      return;
    }
    reload();
  });

  on("version", (data) => {
    if (!ready || data.slug !== slug) {
      return;
    }
    if (currentVersion === null) {
      currentVersion = data.version;
      return;
    }
    if (data.version !== currentVersion) {
      currentVersion = data.version;
      reload();
    }
  });
}
