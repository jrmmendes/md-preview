/**
 * Pure table model shared by the server renderer and the browser island.
 *
 * Nothing here touches the DOM: Markdown/CSV parsing, pivot, filtering,
 * sorting, TSV/Markdown serialization and the numeric heuristics are all
 * testable with `bun test`.
 */

export type TableAlign = "left" | "center" | "right" | null;

export type SortDirection = "asc" | "desc";

export interface TableModel {
  header: string[];
  rows: string[][];
  align: TableAlign[];
}

export interface TableRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

export interface TableValue {
  /** Normalized key used by the value filter. */
  key: string;
  /** Display label shown in the popover. */
  label: string;
  count: number;
}

export interface RawModeState {
  raw: boolean;
  /** True when the document-wide raw view forces this block into raw. */
  locked: boolean;
}

/** Collator used for the natural, accent-insensitive pt-BR ordering. */
export const TABLE_COLLATOR = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
});

/** Minimum width of a resized column, in CSS pixels. */
export const TABLE_MIN_COLUMN_WIDTH = 48;

/** Empty cells and the visual placeholder share the same filter bucket. */
export const EMPTY_VALUE_KEY = "—";

/**
 * Lowercase, strip diacritics and collapse whitespace. Used for search and
 * value matching, never for display.
 */
export function normalizeCellText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Stable key for the per-column value filter. */
export function normalizeValueKey(text: string): string {
  const value = normalizeCellText(text);
  return value === "" ? EMPTY_VALUE_KEY : value;
}

/** Spreadsheet column label: 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = Math.floor(index) + 1;
  if (!Number.isFinite(n) || n < 1) {
    return "";
  }
  let out = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

/**
 * Split one GFM table row into cells, honoring `\|` and `\\` escapes.
 * Leading and trailing pipes are optional.
 */
export function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) {
    body = body.slice(1);
  }
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (char === "\\") {
      const next = body[index + 1];
      if (next === "|" || next === "\\") {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "|") {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  if (cells.length > 0 && cells[cells.length - 1] === "") {
    cells.pop();
  }
  return cells;
}

function parseAlignCell(cell: string): TableAlign {
  const value = cell.trim();
  if (!/^:?-+:?$/.test(value)) {
    return null;
  }
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  if (left) {
    return "left";
  }
  return null;
}

/**
 * Parse a GFM table from Markdown. Returns `null` when the source is not a
 * table, so callers can fall back to the regular Markdown renderer.
 */
export function parseMarkdownTable(source: string): TableModel | null {
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
  if (lines.length < 2) {
    return null;
  }

  const header = splitTableRow(lines[0]!);
  const delimiters = splitTableRow(lines[1]!);
  if (header.length === 0 || header.length !== delimiters.length) {
    return null;
  }
  if (!delimiters.every((cell) => /^:?-+:?$/.test(cell.trim()))) {
    return null;
  }
  const align = delimiters.map(parseAlignCell);

  const rows: string[][] = [];
  for (let index = 2; index < lines.length; index += 1) {
    const cells = splitTableRow(lines[index]!);
    if (cells.length === 0) {
      continue;
    }
    while (cells.length < header.length) {
      cells.push("");
    }
    rows.push(cells.slice(0, header.length));
  }

  return { header, rows, align };
}

function detectCsvDelimiter(source: string): string {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const counts: Array<[string, number]> = [
    [",", 0],
    [";", 0],
    ["\t", 0],
  ];
  let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index]!;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) {
      continue;
    }
    for (const entry of counts) {
      if (char === entry[0]) {
        entry[1] += 1;
      }
    }
  }
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ",";
}

/**
 * Parse RFC 4180-ish CSV: quoted fields, doubled quotes, embedded newlines and
 * CRLF. The delimiter is detected from the first row (comma, semicolon or tab).
 * The first row becomes the header. Returns `null` for empty or malformed
 * input, in which case the fence falls back to a regular code block.
 */
export function parseCsv(source: string): TableModel | null {
  const text = source.replace(/^\uFEFF/, "");
  if (text.trim() === "") {
    return null;
  }
  const delimiter = detectCsvDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let closedQuote = false;

  const pushField = (): void => {
    row.push(field);
    field = "";
    fieldStarted = false;
    closedQuote = false;
  };
  const pushRow = (): void => {
    pushField();
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && !fieldStarted && !closedQuote) {
      quoted = true;
      fieldStarted = true;
      continue;
    }
    if (char === delimiter) {
      pushField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      pushRow();
      continue;
    }
    if (char === '"' && fieldStarted) {
      // A quote inside an unquoted field is kept literally (lenient mode).
      field += char;
      continue;
    }
    field += char;
    fieldStarted = true;
  }

  if (quoted) {
    return null;
  }
  if (field !== "" || fieldStarted || row.length > 0) {
    pushRow();
  }

  if (rows.length === 0) {
    return null;
  }

  const header = rows[0]!.slice();
  let columns = header.length;
  for (const line of rows.slice(1)) {
    columns = Math.max(columns, line.length);
  }
  while (header.length < columns) {
    header.push("");
  }
  const data = rows.slice(1).map((line) => {
    const cells = line.slice();
    while (cells.length < columns) {
      cells.push("");
    }
    return cells;
  });

  return {
    header,
    rows: data,
    align: header.map(() => null),
  };
}

/** Expand or shrink a row to exactly `columns` cells. */
export function normalizeTableRow(row: readonly string[], columns: number): string[] {
  const out = row.slice(0, columns);
  while (out.length < columns) {
    out.push("");
  }
  return out;
}

/** Escape a cell for a GFM table row. */
export function escapeMarkdownCell(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function delimiterFor(align: TableAlign): string {
  if (align === "left") {
    return ":---";
  }
  if (align === "center") {
    return ":---:";
  }
  if (align === "right") {
    return "---:";
  }
  return "---";
}

/** Serialize the displayed table (header + rows) back to GFM. */
export function serializeMarkdownTable(model: TableModel): string {
  const columns = model.rows.reduce(
    (widest, row) => Math.max(widest, row.length),
    model.header.length
  );
  if (columns === 0) {
    return "";
  }
  const header = normalizeTableRow(model.header, columns);
  const align = Array.from({ length: columns }, (_, index) => model.align[index] ?? null);
  const lines = [
    "| " + header.map(escapeMarkdownCell).join(" | ") + " |",
    "| " + align.map(delimiterFor).join(" | ") + " |",
  ];
  for (const row of model.rows) {
    const cells = normalizeTableRow(row, columns);
    lines.push("| " + cells.map(escapeMarkdownCell).join(" | ") + " |");
  }
  return lines.join("\n");
}

/** Normalize a selection rectangle so r1/c1 are the top-left corner. */
export function normalizeRange(range: TableRange): TableRange {
  return {
    r1: Math.min(range.r1, range.r2),
    r2: Math.max(range.r1, range.r2),
    c1: Math.min(range.c1, range.c2),
    c2: Math.max(range.c1, range.c2),
  };
}

/**
 * Serialize a rectangle (or every row when no range is given) as TSV.
 * Out-of-bounds coordinates are clamped.
 */
export function serializeTsv(rows: readonly (readonly string[])[], range?: TableRange | null): string {
  if (rows.length === 0) {
    return "";
  }
  const normalized = range ? normalizeRange(range) : null;
  const r1 = normalized ? Math.max(0, normalized.r1) : 0;
  const r2 = normalized ? Math.min(rows.length - 1, normalized.r2) : rows.length - 1;
  const maxColumns = Math.max(...rows.map((row) => row.length));
  const c1 = normalized ? Math.max(0, normalized.c1) : 0;
  const c2 = normalized ? Math.min(maxColumns - 1, normalized.c2) : maxColumns - 1;
  if (r2 < r1 || c2 < c1) {
    return "";
  }
  const lines: string[] = [];
  for (let r = r1; r <= r2; r += 1) {
    const values: string[] = [];
    for (let c = c1; c <= c2; c += 1) {
      values.push(rows[r]?.[c] ?? "");
    }
    lines.push(values.join("\t"));
  }
  return lines.join("\n");
}

/**
 * Transpose a table: the original first column becomes the new header and the
 * original header (minus its first cell) becomes the first column.
 */
export function pivotTable(model: TableModel): TableModel {
  if (model.header.length === 0) {
    return { header: [], rows: [], align: [] };
  }
  const header = [model.header[0] ?? "", ...model.rows.map((row) => row[0] ?? "")];
  const rows: string[][] = [];
  for (let column = 1; column < model.header.length; column += 1) {
    rows.push([
      model.header[column] ?? "",
      ...model.rows.map((row) => row[column] ?? ""),
    ]);
  }
  return {
    header,
    rows,
    align: header.map<TableAlign>(() => null),
  };
}

const CURRENCY_PREFIX = /^\s*(?:R\$|US\$|USD|BRL|EUR|\$|€|£|¥)\s*/i;

/**
 * Parse a pt-BR friendly number: thousands with `.` or spaces, decimals with
 * `,`, optional currency prefix, percent suffix and sign. Returns `null` when
 * the text is not numeric (dates, free text, empty cells and the em dash).
 */
export function numericKey(text: string): number | null {
  let value = text.trim();
  if (value === "" || value === EMPTY_VALUE_KEY) {
    return null;
  }
  value = value.replace(CURRENCY_PREFIX, "").replace(/\s*%\s*$/, "").trim();
  if (value === "") {
    return null;
  }

  let sign = 1;
  if (value.startsWith("-") || value.startsWith("+")) {
    sign = value.startsWith("-") ? -1 : 1;
    value = value.slice(1);
  }
  value = value.replace(/\s+/g, "");
  if (value === "" || !/^[\d.,]+$/.test(value)) {
    return null;
  }

  if (value.includes(",")) {
    // Comma is the decimal separator: dots are thousands.
    const [integerPart = "", ...rest] = value.split(",");
    if (rest.length > 1) {
      return null;
    }
    const decimals = rest[0] ?? "";
    const integerDigits = integerPart.replace(/\./g, "");
    if (integerDigits === "" || !/^\d+$/.test(integerDigits) || !/^\d+$/.test(decimals)) {
      return null;
    }
    return sign * Number(`${integerDigits}.${decimals}`);
  }

  const dotParts = value.split(".");
  if (dotParts.length > 2) {
    if (!dotParts.every((part) => /^\d+$/.test(part)) || !dotParts.slice(1).every((part) => part.length === 3)) {
      return null;
    }
    return sign * Number(dotParts.join(""));
  }
  if (dotParts.length === 2) {
    const [integerPart, decimals] = dotParts;
    if (!/^\d+$/.test(integerPart ?? "") || !/^\d+$/.test(decimals ?? "")) {
      return null;
    }
    if (decimals.length === 3) {
      // pt-BR thousand separator: 128.402 (the same reading tree uses).
      return sign * Number(`${integerPart}${decimals}`);
    }
    if (decimals.length <= 2) {
      return sign * Number(`${integerPart}.${decimals}`);
    }
    return null;
  }
  if (!/^\d+$/.test(value)) {
    return null;
  }
  return sign * Number(value);
}

/** True when every non-empty cell in the column reads as a number. */
export function isNumericColumn(values: readonly string[]): boolean {
  let sawNumber = false;
  for (const value of values) {
    if (value.trim() === "" || value.trim() === EMPTY_VALUE_KEY) {
      continue;
    }
    if (numericKey(value) === null) {
      return false;
    }
    sawNumber = true;
  }
  return sawNumber;
}

/**
 * Compare two display values. Numeric columns compare the parsed number first
 * (with a locale-aware fallback for ties); text columns use the natural
 * collator so "2" sorts before "10".
 */
export function compareCellValues(
  a: string,
  b: string,
  numeric: boolean,
  collator: Intl.Collator = TABLE_COLLATOR
): number {
  if (numeric) {
    const left = numericKey(a);
    const right = numericKey(b);
    const leftValue = left === null ? Number.NEGATIVE_INFINITY : left;
    const rightValue = right === null ? Number.NEGATIVE_INFINITY : right;
    if (leftValue !== rightValue) {
      return leftValue < rightValue ? -1 : 1;
    }
  }
  return collator.compare(a, b);
}

export interface SortOptions {
  numeric?: boolean;
  collator?: Intl.Collator;
}

/**
 * Stable sort of row indexes by one column. Returns indexes so the caller can
 * reorder DOM rows without losing the original order (the third click restores
 * it by sorting indexes ascending).
 */
export function sortOrder(
  rows: readonly (readonly string[])[],
  column: number,
  direction: SortDirection,
  options: SortOptions = {}
): number[] {
  const numeric = options.numeric ?? false;
  const collator = options.collator ?? TABLE_COLLATOR;
  const sign = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ index, value: row[column] ?? "" }))
    .sort((left, right) => {
      const compared = compareCellValues(left.value, right.value, numeric, collator);
      if (compared !== 0) {
        return compared * sign;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.index);
}

/**
 * Distinct values of one column with their frequency, in display order. The
 * normalized key groups accent/case variants; the label comes from the first
 * occurrence.
 */
export function buildColumnValues(
  values: readonly string[],
  collator: Intl.Collator = TABLE_COLLATOR
): TableValue[] {
  const map = new Map<string, TableValue>();
  for (const text of values) {
    const key = normalizeValueKey(text);
    const label = text.replace(/\s+/g, " ").trim() || EMPTY_VALUE_KEY;
    const entry = map.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      map.set(key, { key, label, count: 1 });
    }
  }
  return [...map.values()].sort((a, b) => collator.compare(a.label, b.label));
}

export interface FilterOptions {
  query?: string;
  /** Column index -> accepted normalized keys. */
  columnFilters?: ReadonlyMap<number, ReadonlySet<string>>;
  /** Skip this column in the global text search (the row-header column). */
  excludeColumn?: number | null;
  /** Pre-normalized rows, to avoid normalizing again while typing. */
  normalized?: readonly (readonly string[])[];
}

/**
 * Row visibility for the global search plus the per-column value filters.
 * Search is accent/case-insensitive and matches any cell of the row.
 */
export function filterRows(
  rows: readonly (readonly string[])[],
  options: FilterOptions = {}
): boolean[] {
  const query = normalizeCellText(options.query ?? "");
  const filters = [...(options.columnFilters?.entries() ?? [])];
  const excludeColumn = options.excludeColumn ?? null;
  const normalized =
    options.normalized ??
    rows.map((row) => row.map((cell) => normalizeCellText(cell)));

  return rows.map((row, index) => {
    const texts = normalized[index] ?? [];
    for (const [column, accepted] of filters) {
      if (!accepted.has(normalizeValueKey(texts[column] ?? ""))) {
        return false;
      }
    }
    if (query !== "") {
      for (let column = 0; column < row.length; column += 1) {
        if (column === excludeColumn) {
          continue;
        }
        if ((texts[column] ?? "").includes(query)) {
          return true;
        }
      }
      return false;
    }
    return true;
  });
}

/** Clamp a column width to the resize bounds. */
export function clampColumnWidth(
  width: number,
  min = TABLE_MIN_COLUMN_WIDTH,
  max = Number.POSITIVE_INFINITY
): number {
  if (!Number.isFinite(width)) {
    return min;
  }
  return Math.max(min, Math.min(max, width));
}

/**
 * Combine the per-block raw toggle with the document-wide raw view.
 *
 * The global mode always wins and locks the block toggle: a CSV block cannot
 * show the grid while the whole document is in raw mode, nor can it leave raw
 * by itself until the global view closes.
 */
export function resolveRawMode(blockRaw: boolean, globalRaw: boolean): RawModeState {
  return {
    raw: globalRaw || blockRaw,
    locked: globalRaw,
  };
}
