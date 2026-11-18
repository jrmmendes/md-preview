const INTENT_KEY = "mdprv_focus_pending";
const INTENT_VERSION = 1;
const INTENT_TTL_MS = 15_000;

const memory = new Map<string, string>();

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface WindowLike {
  sessionStorage?: StorageLike;
}

export type ActivationPlan = "focus" | "navigate" | "ignore";

/** Path + query, the part that identifies a document for the preview UI. */
export function documentKey(href: string, base = "http://127.0.0.1/"): string | null {
  try {
    const url = new URL(href, base);
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * Decide what a tab should do with an `activate` event.
 *
 * Same-origin targets only; the document key ignores the hash so anchors do
 * not trigger a navigation. A different document navigates in place instead of
 * opening another tab.
 */
export function activationPlan(currentHref: string, targetUrl: string): ActivationPlan {
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentHref);
    target = new URL(targetUrl, current);
  } catch {
    return "ignore";
  }
  if (target.origin !== current.origin || target.protocol !== "http:") {
    return "ignore";
  }
  const currentKey = documentKey(current.href);
  const targetKey = documentKey(target.href);
  if (currentKey === null || targetKey === null) {
    return "ignore";
  }
  return currentKey === targetKey ? "focus" : "navigate";
}

function session(): StorageLike | null {
  try {
    const scope = globalThis as unknown as Record<string, unknown>;
    const win = scope["window"] as WindowLike | undefined;
    return win?.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Remember that the next page load was requested by the CLI. */
export function markFocusIntent(url: string, now = Date.now()): void {
  const value = JSON.stringify({ v: INTENT_VERSION, url, ts: now });
  memory.set(INTENT_KEY, value);
  try {
    session()?.setItem(INTENT_KEY, value);
  } catch {
    /* storage blocked: memory is enough for this page */
  }
}

/**
 * Consume a pending intent when the loaded document matches its target.
 *
 * Intents older than 15 seconds or aimed at another document are discarded so
 * a manual reload never raises a stale focus cue.
 */
export function consumeFocusIntent(currentHref: string, now = Date.now()): boolean {
  let raw: string | null = null;
  try {
    raw = session()?.getItem(INTENT_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) {
    raw = memory.get(INTENT_KEY) ?? null;
  }
  memory.delete(INTENT_KEY);
  try {
    session()?.removeItem(INTENT_KEY);
  } catch {
    /* ignore */
  }
  if (raw === null) {
    return false;
  }
  let data: { v?: unknown; url?: unknown; ts?: unknown };
  try {
    data = JSON.parse(raw);
  } catch {
    return false;
  }
  if (
    data.v !== INTENT_VERSION ||
    typeof data.url !== "string" ||
    typeof data.ts !== "number" ||
    now - data.ts > INTENT_TTL_MS ||
    data.ts > now + 1000
  ) {
    return false;
  }
  const currentKey = documentKey(currentHref);
  const intentKey = documentKey(data.url, currentHref);
  return currentKey !== null && currentKey === intentKey;
}
