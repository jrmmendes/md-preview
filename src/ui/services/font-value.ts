export const GENERIC_FAMILIES = [
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
  "cursive",
  "fantasy",
] as const;

export const DEFAULT_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

export const MAX_FAMILY_LENGTH = 128;
export const MAX_STACK_LENGTH = 512;

const FORBIDDEN_FAMILY_CHARS = /[\u0000-\u001f\u007f;{}<>"'\\]/;
const FORBIDDEN_STACK_CHARS = /[\u0000-\u001f\u007f;{}<>\\]/;

export function sanitizeFamily(input: unknown): string | null {
  if (typeof input !== "string" || FORBIDDEN_FAMILY_CHARS.test(input)) {
    return null;
  }
  const family = input.trim().replace(/\s+/g, " ");
  if (family === "" || family.length > MAX_FAMILY_LENGTH) {
    return null;
  }
  return family;
}

export function isGenericFamily(family: string): boolean {
  return (GENERIC_FAMILIES as readonly string[]).includes(family.toLowerCase());
}

export function fontStack(family?: string | null): string {
  const safe = family ? sanitizeFamily(family) : null;
  if (!safe) {
    return DEFAULT_FONT_STACK;
  }
  if (isGenericFamily(safe)) {
    const rest = DEFAULT_FONT_STACK.split(",")
      .map((token) => token.trim())
      .filter((token) => token !== "" && token.toLowerCase() !== safe.toLowerCase());
    return [safe, ...rest].join(", ");
  }
  return `"${safe}", ${DEFAULT_FONT_STACK}`;
}

export function safeStack(family: string, stack: unknown): string {
  if (
    typeof stack === "string" &&
    stack.length <= MAX_STACK_LENGTH &&
    stack.trim() !== "" &&
    !FORBIDDEN_STACK_CHARS.test(stack)
  ) {
    return stack.trim();
  }
  return fontStack(family);
}
