import {
  activationPlan,
  consumeFocusIntent,
  markFocusIntent,
} from "../services/activate";
import { on } from "../services/events";

const TITLE_PREFIX = "● ";
const NOTIFICATION_TAG = "mdprv-preview";

let originalTitle: string | null = null;
let badgeSet = false;

function baseTitle(): string {
  return originalTitle ?? document.title.replace(/^● /, "");
}

function badgeTitle(): void {
  if (originalTitle !== null) {
    return;
  }
  originalTitle = document.title;
  if (!originalTitle.startsWith(TITLE_PREFIX)) {
    document.title = TITLE_PREFIX + originalTitle;
  }
}

function clearTitle(): void {
  if (originalTitle === null) {
    return;
  }
  document.title = originalTitle;
  originalTitle = null;
}

interface BadgingNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

function setBadge(on: boolean): void {
  const nav = navigator as unknown as BadgingNavigator;
  try {
    if (on) {
      if (typeof nav.setAppBadge !== "function") {
        return;
      }
      badgeSet = true;
      void nav.setAppBadge(1).catch(() => {
        badgeSet = false;
      });
      return;
    }
    if (badgeSet && typeof nav.clearAppBadge === "function") {
      void nav.clearAppBadge().catch(() => {});
    }
  } catch {
    /* badging is optional */
  }
  if (!on) {
    badgeSet = false;
  }
}

function clearCues(): void {
  clearTitle();
  setBadge(false);
}

function notify(title: string): void {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    const notification = new Notification(title, {
      body: "Preview updated from the command line",
      tag: NOTIFICATION_TAG,
      silent: true,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* focus is best-effort */
      }
      notification.close();
    };
    setTimeout(() => notification.close(), 8000);
  } catch {
    /* notifications are optional */
  }
}

/**
 * Best-effort reveal of a background tab.
 *
 * Browsers only raise a window from script when there is user activation, so
 * `window.focus()` is attempted and may be ignored. The title marker and the
 * app badge always work and make the tab easy to spot; a notification is only
 * shown when the user already granted permission.
 */
export function revealTab(): void {
  const wasHidden = document.visibilityState === "hidden";
  const hadFocus = document.hasFocus();
  try {
    window.focus();
  } catch {
    /* ignore */
  }
  if (!wasHidden && hadFocus) {
    clearCues();
    return;
  }
  badgeTitle();
  setBadge(true);
  if (wasHidden) {
    notify(baseTitle());
  }
}

function clearWhenVisible(): void {
  if (document.visibilityState === "visible" && document.hasFocus()) {
    clearCues();
  }
}

export function initActivate(): void {
  let href = "";
  try {
    href = window.location.href;
  } catch {
    return;
  }
  if (!href) {
    return;
  }

  on("activate", (data) => {
    if (!data || typeof data.url !== "string") {
      return;
    }
    const plan = activationPlan(href, data.url);
    if (plan === "ignore") {
      return;
    }
    if (plan === "navigate") {
      markFocusIntent(data.url);
      window.location.assign(data.url);
      return;
    }
    revealTab();
  });

  if (consumeFocusIntent(href)) {
    revealTab();
  }

  window.addEventListener("focus", clearCues);
  document.addEventListener("visibilitychange", clearWhenVisible);
}
