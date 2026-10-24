import { writeLoaderIntent } from "../prefs";
import { on } from "../services/events";

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
    if (!data.changed.includes(active) && !data.changed.includes("auto")) {
      return;
    }
    writeLoaderIntent(location.pathname);
    location.reload();
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
      writeLoaderIntent(location.pathname);
      location.reload();
    }
  });
}
