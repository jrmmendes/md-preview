/**
 * Validation of imported color themes (`theme.json`).
 *
 * The authoritative rules live in `validate.ts`; this module only adapts the
 * error shape used by the HTTP endpoints and centralizes the file suffix.
 */
import { THEME_NAME_RE } from "./constants";
import type { Theme } from "./types";
import { validateTheme } from "./validate";

export const COLOR_THEME_FILE_SUFFIX = ".json";

export type ColorThemeErrorCode = "invalid" | "exists" | "too-large";

export class ColorThemeError extends Error {
  constructor(
    public readonly code: ColorThemeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ColorThemeError";
  }
}

export function isThemeSlug(value: unknown): value is string {
  return typeof value === "string" && THEME_NAME_RE.test(value);
}

export function colorThemeFileName(name: string): string {
  return `${name}${COLOR_THEME_FILE_SUFFIX}`;
}

/**
 * Validates a color theme against the runtime contract. The wrapper `name`
 * must already be the chosen slug; the file name will match it.
 */
export function validateColorTheme(name: string, raw: unknown): Theme {
  if (!isThemeSlug(name)) {
    throw new ColorThemeError(
      "invalid",
      "name must match ^[a-z0-9][a-z0-9-]{0,63}$"
    );
  }
  try {
    return validateTheme(name, raw);
  } catch (err) {
    throw new ColorThemeError(
      "invalid",
      err instanceof Error ? err.message : String(err)
    );
  }
}
