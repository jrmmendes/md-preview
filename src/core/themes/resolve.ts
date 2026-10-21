import { DEFAULT_THEME, hasTheme } from "./tokens";

export { DEFAULT_THEME, hasTheme };

export function resolveThemeName(
  query: string | null,
  cookie: string | null,
  fallback: string
): string {
  if (hasTheme(query)) {
    return query!;
  }
  if (hasTheme(cookie)) {
    return cookie!;
  }
  if (hasTheme(fallback)) {
    return fallback;
  }
  return DEFAULT_THEME;
}
