import type { FontCategory, FontInfo } from "./contract";

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

const FORBIDDEN_FAMILY_CHARS = /[\u0000-\u001f\u007f;{}<>"'\\]/;
const FAMILY_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export interface FcFontRecord {
  family: string;
  style: string;
  spacing: number | null;
}

export function sanitizeFamily(input: string): string | null {
  if (typeof input !== "string" || FORBIDDEN_FAMILY_CHARS.test(input)) {
    return null;
  }
  const family = input.trim().replace(/\s+/g, " ");
  if (family === "" || family.length > MAX_FAMILY_LENGTH) {
    return null;
  }
  return family;
}

export function fontStack(family?: string | null): string {
  const safe = family ? sanitizeFamily(family) : null;
  if (!safe) {
    return DEFAULT_FONT_STACK;
  }
  const lower = safe.toLowerCase();
  if ((GENERIC_FAMILIES as readonly string[]).includes(lower)) {
    const rest = DEFAULT_FONT_STACK.split(",")
      .map((token) => token.trim())
      .filter((token) => token !== "" && token.toLowerCase() !== lower);
    return [safe, ...rest].join(", ");
  }
  return `"${safe}", ${DEFAULT_FONT_STACK}`;
}

function parseSpacing(value: string): number | null {
  const text = value.trim();
  if (text === "") {
    return null;
  }
  const spacing = Number(text);
  return Number.isInteger(spacing) ? spacing : null;
}

export function parseFcList(text: string): FcFontRecord[] {
  const records: FcFontRecord[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.trim() === "") {
      continue;
    }
    const fields = line.split("\t");
    if (fields.length < 3) {
      continue;
    }
    const style = fields[1].trim();
    const spacing = parseSpacing(fields[2]);
    for (const rawFamily of fields[0].split(",")) {
      const family = sanitizeFamily(rawFamily);
      if (!family) {
        continue;
      }
      records.push({ family, style, spacing });
    }
  }
  return records;
}

export function categorizeFamily(family: string, spacings: readonly number[] = []): FontCategory {
  if (spacings.some((spacing) => spacing === 100 || spacing === 110)) {
    return "monospace";
  }
  const name = family.toLowerCase();
  if (/(mono|courier|consolas|menlo|monaco|inconsolata|iosevka|hack|fira code|jetbrains)/.test(name)) {
    return "monospace";
  }
  if (/(script|handwriting|cursive|calligraph|comic|brush|pacifico|lobster|dancing)/.test(name)) {
    return "script";
  }
  if (/(sans|system-ui|arial|helvetica|roboto|inter|ubuntu|fira|noto sans|dejavu sans|lato|montserrat|poppins|segoe ui)/.test(name)) {
    return "sans";
  }
  if (/(serif|roman|times|georgia|garamond|palatino|cambria|merriweather|playfair|baskerville)/.test(name)) {
    return "serif";
  }
  return "unknown";
}

interface FontGroup {
  family: string;
  styles: Map<string, string>;
  spacings: Set<number>;
}

export function normalizeFonts(records: readonly FcFontRecord[]): FontInfo[] {
  const groups = new Map<string, FontGroup>();

  for (const record of records) {
    const family = sanitizeFamily(record.family);
    if (!family) {
      continue;
    }
    const key = family.toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { family, styles: new Map(), spacings: new Set() };
      groups.set(key, group);
    }
    const style = record.style.trim().replace(/\s+/g, " ");
    if (style !== "") {
      const styleKey = style.toLowerCase();
      if (!group.styles.has(styleKey)) {
        group.styles.set(styleKey, style);
      }
    }
    if (record.spacing !== null && Number.isFinite(record.spacing)) {
      group.spacings.add(record.spacing);
    }
  }

  const fonts = [...groups.values()].map((group) => ({
    family: group.family,
    styles: [...group.styles.values()].sort(FAMILY_COLLATOR.compare),
    category: categorizeFamily(group.family, [...group.spacings]),
  }));

  fonts.sort((a, b) => FAMILY_COLLATOR.compare(a.family, b.family));
  return fonts;
}
