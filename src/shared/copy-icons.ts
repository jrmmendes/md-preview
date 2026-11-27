/**
 * Icon markup shared by the copy buttons.
 *
 * Kept free of DOM and Shiki imports so both the server renderer
 * (`src/core/markdown/diff.ts`, table toolbar) and the client islands can use
 * them. The actual glyph comes from CSS (`src/ui/styles/icons.css`) via
 * `data-icon`, so it follows `currentColor` and the active icon pack without
 * re-rendering. Never inline pack SVGs through `innerHTML`: these spans only
 * carry the key.
 */

function iconSpan(key: string): string {
  return `<span class="mdprv-icon" data-icon="${key}" aria-hidden="true"></span>`;
}

export const COPY_ICON = iconSpan("copy");

export const CSV_ICON = iconSpan("csv");

export const CHECK_ICON = iconSpan("check");
