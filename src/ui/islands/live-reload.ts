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

/** An `auto` theme follows the system scheme and reacts to any theme change;
 *  a fixed theme only reacts to its own file. */
function themeChanged(active: string, kind: string | null, changed: string[]): boolean {
  if (kind === "auto") {
    return changed.length > 0;
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
    const root = document.documentElement;
    const active = root.getAttribute("data-theme") ?? "auto";
    const kind =
      root.getAttribute("data-theme-kind") ??
      (active === "auto" ? "auto" : null);
    if (!themeChanged(active, kind, data.changed)) {
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

  on("icons", (data) => {
    const active = document.documentElement.getAttribute("data-icons") ?? "";
    const changed = Array.isArray(data.changed) ? data.changed : [];
    // The generated CSS points at the active pack; reload so its mask URLs
    // are re-emitted when that pack is edited or removed.
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
