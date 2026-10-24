import { DEFAULT_THEME } from "./constants";
import { hasTheme } from "./index";
import type { ThemeStore } from "./store";

export function resolveThemeName(
  query: string | null,
  cookie: string | null,
  fallback: string,
  store?: ThemeStore
): string {
  const has = (name: string | null): boolean => (store ? store.has(name) : hasTheme(name));
  if (has(query)) {
    return query!;
  }
  if (has(cookie)) {
    return cookie!;
  }
  if (has(fallback)) {
    return fallback;
  }
  return DEFAULT_THEME;
}
