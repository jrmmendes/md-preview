export const LOADER_INTENT_VERSION = 1;
export const LOADER_INTENT_MAX_AGE_MS = 15_000;

export interface LoaderIntent {
  path: string;
  ts: number;
}

export function parseLoaderIntent(
  raw: string | null,
  now: number,
  currentPath: string
): LoaderIntent | null {
  if (raw === null) {
    return null;
  }
  if (raw === "1") {
    return { path: currentPath, ts: now };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as { v?: unknown; path?: unknown; ts?: unknown };
  if (
    candidate.v !== LOADER_INTENT_VERSION ||
    typeof candidate.path !== "string" ||
    typeof candidate.ts !== "number" ||
    !Number.isFinite(candidate.ts)
  ) {
    return null;
  }
  if (now - candidate.ts > LOADER_INTENT_MAX_AGE_MS) {
    return null;
  }
  return { path: candidate.path, ts: candidate.ts };
}

export function serializeLoaderIntent(path: string, now: number): string {
  return JSON.stringify({ v: LOADER_INTENT_VERSION, path, ts: now });
}

export function intentMatches(intent: LoaderIntent | null, path: string): boolean {
  return intent !== null && intent.path === path;
}
