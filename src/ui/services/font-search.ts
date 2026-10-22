const COMBINING_MARKS = /[\u0300-\u036f]/g;
const WORD_BREAK = /[\s\-_.]+/;
const FAMILY_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .trim();
}

function isSubsequence(query: string, target: string): boolean {
  let index = 0;
  for (const character of target) {
    if (character === query[index]) {
      index += 1;
      if (index === query.length) {
        return true;
      }
    }
  }
  return false;
}

function rank(family: string, query: string): number {
  const name = normalizeForSearch(family);
  if (query === "") {
    return 0;
  }
  if (name === query) {
    return 0;
  }
  if (name.startsWith(query)) {
    return 1;
  }
  if (name.split(WORD_BREAK).some((word) => word !== "" && word.startsWith(query))) {
    return 2;
  }
  if (name.includes(query)) {
    return 3;
  }
  if (isSubsequence(query, name)) {
    return 4;
  }
  return -1;
}

export function searchFonts<T extends { family: string }>(
  fonts: readonly T[],
  query: string,
  limit = 80
): T[] {
  if (limit <= 0) {
    return [];
  }
  const normalized = normalizeForSearch(query);
  const ranked: { font: T; rank: number }[] = [];
  for (const font of fonts) {
    const value = rank(font.family, normalized);
    if (value >= 0) {
      ranked.push({ font, rank: value });
    }
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return FAMILY_COLLATOR.compare(a.font.family, b.font.family);
  });
  return ranked.slice(0, limit).map((entry) => entry.font);
}
