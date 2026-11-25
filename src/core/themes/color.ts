/**
 * Shared "safe CSS color" validator.
 *
 * Used by the theme validator and by the custom Shiki importer, so both reject
 * the same dangerous values (`url()`, `var()`, control characters, ...).
 */
const COLOR = /^#[0-9a-fA-F]{3,8}$/;
const COLOR_FN = /^(?:rgba?|hsla?)\(\s*[0-9.%\s,/+-]+\)$/;

export function isColor(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    return false;
  }
  if (/url\(|var\(|@import|[;{}<>\u0000-\u001f\u007f]/i.test(value)) {
    return false;
  }
  return value === "transparent" || COLOR.test(value) || COLOR_FN.test(value);
}
