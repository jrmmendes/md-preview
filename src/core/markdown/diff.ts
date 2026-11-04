/**
 * Parser and server-side renderer for ```diff fences.
 *
 * Both views (unified/inline and side-by-side) are rendered on the server so
 * the block stays readable without JavaScript and the client never needs
 * Shiki. The island in `src/ui/islands/diff-view.ts` only toggles the panes.
 *
 * Parsing is deliberately conservative: a fence without a single recognizable
 * diff line returns `null`, which tells the Markdown renderer to fall back to a
 * regular code block instead of breaking the page.
 */

import type { ThemedTokenWithVariants } from "shiki/types";

import { codeToThemedTokens } from "./highlight";

export type DiffLineKind = "context" | "add" | "del" | "meta" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  /** Content without the `+`, `-` or space prefix. */
  text: string;
  /** 1-based line number on the old side, `null` for additions. */
  oldNumber: number | null;
  /** 1-based line number on the new side, `null` for deletions. */
  newNumber: number | null;
}

export interface DiffCell {
  kind: "context" | "add" | "del" | "empty";
  text: string;
  number: number | null;
  /** Source line, used to look up pre-tokenized content. */
  line: DiffLine | null;
}

export interface DiffRow {
  kind: DiffLineKind;
  /** Full-width content for `meta`/`hunk` rows, when set. */
  full: string | null;
  left: DiffCell | null;
  right: DiffCell | null;
}

export interface DiffRenderOptions {
  /** Active theme name, used to pick the Shiki light/dark pair. */
  themeName: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Very large diffs skip Shiki; the plain escaped text keeps rendering fast. */
const MAX_HIGHLIGHT_LINES = 2000;

const META_RES = [
  /^diff --git /,
  /^index /,
  /^new file mode /,
  /^deleted file mode /,
  /^old mode /,
  /^new mode /,
  /^similarity index /,
  /^dissimilarity index /,
  /^rename from /,
  /^rename to /,
  /^copy from /,
  /^copy to /,
  /^Binary files /,
  /^GIT binary patch/,
  /^--- /,
  /^\+\+\+ /,
];

function isMetaLine(line: string): boolean {
  return META_RES.some((pattern) => pattern.test(line));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function metaLine(line: string): DiffLine {
  return { kind: "meta", text: line, oldNumber: null, newNumber: null };
}

/**
 * Parse a unified diff body. Returns `null` when no hunk or body line is found
 * (empty fences, prose, unrelated text), so the caller can fall back to a
 * normal code block.
 *
 * File headers (`diff --git`, `index`, `---`, `+++`, ...), the
 * `\ No newline at end of file` marker and other Git metadata become `meta`
 * rows. Line numbers come from `@@ -a,b +c,d @@` headers. A fence with only
 * `+`/`-` lines (no header) is accepted as an implicit hunk starting at 1.
 */
export function parseUnifiedDiff(code: string): DiffLine[] | null {
  const normalized = code.replace(/\r\n?/g, "\n");
  if (normalized.trim() === "") {
    return null;
  }

  const rawLines = normalized.split("\n");
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
    rawLines.pop();
  }

  const lines: DiffLine[] = [];
  let inHunk = false;
  let oldNumber = 0;
  let newNumber = 0;
  let sawBody = false;

  const pushContext = (text: string): void => {
    lines.push({
      kind: "context",
      text,
      oldNumber: oldNumber++,
      newNumber: newNumber++,
    });
    sawBody = true;
  };

  for (const raw of rawLines) {
    const hunk = HUNK_RE.exec(raw);
    if (hunk) {
      inHunk = true;
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[3]);
      lines.push({ kind: "hunk", text: raw, oldNumber: null, newNumber: null });
      continue;
    }

    if (inHunk) {
      if (raw.startsWith("\\")) {
        lines.push(metaLine(raw));
        continue;
      }
      if (raw.startsWith("+")) {
        lines.push({
          kind: "add",
          text: raw.slice(1),
          oldNumber: null,
          newNumber: newNumber++,
        });
        sawBody = true;
        continue;
      }
      if (raw.startsWith("-")) {
        lines.push({
          kind: "del",
          text: raw.slice(1),
          oldNumber: oldNumber++,
          newNumber: null,
        });
        sawBody = true;
        continue;
      }
      if (raw.startsWith(" ")) {
        pushContext(raw.slice(1));
        continue;
      }
      // A blank context line whose trailing space was stripped.
      if (raw === "") {
        pushContext("");
        continue;
      }
      if (isMetaLine(raw)) {
        inHunk = false;
        lines.push(metaLine(raw));
        continue;
      }
      // Unknown content inside a hunk: keep it visible, do not lose the state.
      lines.push(metaLine(raw));
      continue;
    }

    if (isMetaLine(raw) || raw.startsWith("\\")) {
      lines.push(metaLine(raw));
      continue;
    }

    // Implicit hunk: a fence that only contains +/- lines.
    if (raw.startsWith("+") || raw.startsWith("-")) {
      inHunk = true;
      oldNumber = 1;
      newNumber = 1;
      if (raw.startsWith("+")) {
        lines.push({
          kind: "add",
          text: raw.slice(1),
          oldNumber: null,
          newNumber: newNumber++,
        });
      } else {
        lines.push({
          kind: "del",
          text: raw.slice(1),
          oldNumber: oldNumber++,
          newNumber: null,
        });
      }
      sawBody = true;
      continue;
    }

    // Prose before or after the diff is preserved as meta only if the fence
    // later turns out to contain a real diff.
    lines.push(metaLine(raw));
  }

  return sawBody ? lines : null;
}

function emptyCell(): DiffCell {
  return { kind: "empty", text: "", number: null, line: null };
}

function contextCell(line: DiffLine): DiffCell {
  return {
    kind: "context",
    text: line.text,
    number: line.oldNumber,
    line,
  };
}

/**
 * Group parsed lines into side-by-side rows. Inside each run of changes the
 * i-th deletion is paired with the i-th addition; leftovers keep one side
 * empty. Context lines fill both columns with the same row.
 */
export function pairDiffRows(lines: DiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.kind === "meta" || line.kind === "hunk") {
      rows.push({ kind: line.kind, full: line.text, left: null, right: null });
      index += 1;
      continue;
    }

    if (line.kind === "context") {
      rows.push({
        kind: "context",
        full: null,
        left: contextCell(line),
        right: { kind: "context", text: line.text, number: line.newNumber, line },
      });
      index += 1;
      continue;
    }

    const deletions: DiffLine[] = [];
    const additions: DiffLine[] = [];
    while (
      index < lines.length &&
      (lines[index].kind === "del" || lines[index].kind === "add")
    ) {
      const changed = lines[index];
      if (changed.kind === "del") {
        deletions.push(changed);
      } else {
        additions.push(changed);
      }
      index += 1;
    }

    const count = Math.max(deletions.length, additions.length);
    for (let offset = 0; offset < count; offset += 1) {
      const deletion = deletions[offset];
      const addition = additions[offset];
      const left: DiffCell = deletion
        ? { kind: "del", text: deletion.text, number: deletion.oldNumber, line: deletion }
        : emptyCell();
      const right: DiffCell = addition
        ? { kind: "add", text: addition.text, number: addition.newNumber, line: addition }
        : emptyCell();
      rows.push({
        kind: deletion ? "del" : "add",
        full: null,
        left,
        right,
      });
    }
  }

  return rows;
}

type TokenMap = Map<DiffLine, ThemedTokenWithVariants[]>;

interface TokenMaps {
  old: TokenMap;
  new: TokenMap;
}

function tokenizeSide(
  side: DiffLine[],
  lang: string,
  themeName: string
): TokenMap {
  const map: TokenMap = new Map();
  if (!lang || side.length === 0) {
    return map;
  }
  const tokens = codeToThemedTokens(
    side.map((line) => line.text).join("\n"),
    lang,
    themeName
  );
  if (!tokens) {
    return map;
  }
  side.forEach((line, index) => {
    const lineTokens = tokens[index];
    if (lineTokens) {
      map.set(line, lineTokens);
    }
  });
  return map;
}

const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKETHROUGH = 8;

function fontCss(fontStyle: number | undefined): Array<[string, string]> {
  if (!fontStyle) {
    return [];
  }
  const css: Array<[string, string]> = [];
  if (fontStyle & ITALIC) {
    css.push(["font-style", "italic"]);
  }
  if (fontStyle & BOLD) {
    css.push(["font-weight", "bold"]);
  }
  const decorations: string[] = [];
  if (fontStyle & UNDERLINE) {
    decorations.push("underline");
  }
  if (fontStyle & STRIKETHROUGH) {
    decorations.push("line-through");
  }
  if (decorations.length > 0) {
    css.push(["text-decoration", decorations.join(" ")]);
  }
  return css;
}

function tokenStyle(token: ThemedTokenWithVariants): string {
  const light = token.variants.light;
  const dark = token.variants.dark;
  const declarations: string[] = [];
  if (light?.color) {
    declarations.push(`--shiki-light:${light.color}`);
  }
  if (dark?.color) {
    declarations.push(`--shiki-dark:${dark.color}`);
  }
  for (const [property, value] of fontCss(light?.fontStyle)) {
    declarations.push(`--shiki-light-${property}:${value}`);
  }
  for (const [property, value] of fontCss(dark?.fontStyle)) {
    declarations.push(`--shiki-dark-${property}:${value}`);
  }
  return declarations.join(";");
}

function renderLineContent(
  lineTokens: ThemedTokenWithVariants[] | undefined,
  text: string
): string {
  if (!lineTokens || lineTokens.length === 0) {
    return escapeHtml(text);
  }
  let html = "";
  for (const token of lineTokens) {
    const style = tokenStyle(token);
    const content = escapeHtml(token.content);
    html += style
      ? `<span class="mdprv-diff-token" style="${escapeHtml(style)}">${content}</span>`
      : content;
  }
  return html;
}

function rowClass(kind: DiffLineKind): string {
  return kind === "context" ? "is-context" : `is-${kind}`;
}

function sideClass(cell: DiffCell): string {
  return cell.kind === "add" || cell.kind === "del" ? ` is-${cell.kind}` : "";
}

function markFor(kind: DiffCell["kind"]): string {
  if (kind === "add") {
    return "+";
  }
  if (kind === "del") {
    return "-";
  }
  return " ";
}

function inlineRow(line: DiffLine, tokens: TokenMaps): string {
  if (line.kind === "meta" || line.kind === "hunk") {
    return `<tr class="mdprv-diff-row ${rowClass(line.kind)}" data-diff-kind="${line.kind}"><td class="mdprv-diff-meta" colspan="4">${escapeHtml(line.text)}</td></tr>`;
  }

  const changed = line.kind === "add" || line.kind === "del";
  const extra = changed ? ` is-${line.kind}` : "";
  const lineTokens =
    line.kind === "add" ? tokens.new.get(line) : tokens.old.get(line);

  return (
    `<tr class="mdprv-diff-row ${rowClass(line.kind)}" data-diff-kind="${line.kind}">` +
    `<td class="mdprv-diff-num${extra}">${line.oldNumber ?? ""}</td>` +
    `<td class="mdprv-diff-num${extra}">${line.newNumber ?? ""}</td>` +
    `<td class="mdprv-diff-mark${extra}">${markFor(line.kind)}</td>` +
    `<td class="mdprv-diff-code${extra}">${renderLineContent(lineTokens, line.text)}</td>` +
    `</tr>`
  );
}

function splitCell(cell: DiffCell, side: "old" | "new", tokens: TokenMaps): string {
  if (cell.kind === "empty") {
    return (
      `<td class="mdprv-diff-num is-empty"></td>` +
      `<td class="mdprv-diff-mark is-empty"></td>` +
      `<td class="mdprv-diff-code is-empty"></td>`
    );
  }
  const extra = sideClass(cell);
  const map = side === "old" ? tokens.old : tokens.new;
  const lineTokens = cell.line ? map.get(cell.line) : undefined;

  return (
    `<td class="mdprv-diff-num${extra}">${cell.number ?? ""}</td>` +
    `<td class="mdprv-diff-mark${extra}">${markFor(cell.kind)}</td>` +
    `<td class="mdprv-diff-code${extra}">${renderLineContent(lineTokens, cell.text)}</td>`
  );
}

function splitRow(row: DiffRow, tokens: TokenMaps): string {
  if (row.full !== null) {
    return `<tr class="mdprv-diff-row ${rowClass(row.kind)}" data-diff-kind="${row.kind}"><td class="mdprv-diff-meta" colspan="6">${escapeHtml(row.full)}</td></tr>`;
  }

  const left = row.left;
  const right = row.right;
  if (!left || !right) {
    return "";
  }

  const classes = new Set<string>(["mdprv-diff-row"]);
  for (const cell of [left, right]) {
    if (cell.kind === "add" || cell.kind === "del") {
      classes.add(`is-${cell.kind}`);
    }
  }
  if (classes.size === 1) {
    classes.add("is-context");
  }
  const dataKind =
    left.kind === "del" ? "del" : right.kind === "add" ? "add" : "context";

  return (
    `<tr class="${Array.from(classes).join(" ")}" data-diff-kind="${dataKind}">` +
    splitCell(left, "old", tokens) +
    splitCell(right, "new", tokens) +
    `</tr>`
  );
}

function inlineTable(lines: DiffLine[], tokens: TokenMaps): string {
  const rows = lines.map((line) => inlineRow(line, tokens)).join("");
  return (
    `<div class="mdprv-diff-pane mdprv-diff-pane--inline" data-diff-pane="inline">` +
    `<table class="mdprv-diff-table mdprv-diff-table--inline">` +
    `<colgroup><col class="mdprv-diff-col-num"><col class="mdprv-diff-col-num"><col class="mdprv-diff-col-mark"><col></colgroup>` +
    `<thead class="mdprv-diff-thead"><tr>` +
    `<th class="mdprv-diff-num" scope="col">Antigo</th>` +
    `<th class="mdprv-diff-num" scope="col">Novo</th>` +
    `<th class="mdprv-diff-mark" scope="col"><span class="mdprv-visually-hidden">Marcador</span></th>` +
    `<th class="mdprv-diff-code" scope="col">Código</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

function splitTable(lines: DiffLine[], tokens: TokenMaps): string {
  const rows = pairDiffRows(lines)
    .map((row) => splitRow(row, tokens))
    .join("");
  return (
    `<div class="mdprv-diff-pane mdprv-diff-pane--split" data-diff-pane="split" hidden>` +
    `<table class="mdprv-diff-table mdprv-diff-table--split">` +
    `<colgroup><col class="mdprv-diff-col-num"><col class="mdprv-diff-col-mark"><col class="mdprv-diff-col-code"><col class="mdprv-diff-col-num"><col class="mdprv-diff-col-mark"><col class="mdprv-diff-col-code"></colgroup>` +
    `<thead class="mdprv-diff-thead"><tr>` +
    `<th class="mdprv-diff-num" scope="col">Antigo</th>` +
    `<th class="mdprv-diff-mark" scope="col"><span class="mdprv-visually-hidden">Marcador</span></th>` +
    `<th class="mdprv-diff-code" scope="col">Código</th>` +
    `<th class="mdprv-diff-num" scope="col">Novo</th>` +
    `<th class="mdprv-diff-mark" scope="col"><span class="mdprv-visually-hidden">Marcador</span></th>` +
    `<th class="mdprv-diff-code" scope="col">Código</th>` +
    `</tr></thead>` +
    `<tbody>${rows}</tbody></table></div>`
  );
}

/**
 * Render a `diff` fence as a toggleable block containing both views.
 *
 * `lang` is the optional extra token in the fence info (```diff tsx```). When
 * it is a loaded Shiki language, each line is tokenized with the active
 * light/dark theme pair; otherwise (or on any failure) the text is escaped and
 * rendered plainly. Returns `null` when the body is not a recognizable diff.
 */
export function renderDiff(
  code: string,
  lang: string,
  options: DiffRenderOptions
): string | null {
  const lines = parseUnifiedDiff(code);
  if (!lines) {
    return null;
  }

  const oldSide = lines.filter(
    (line) => line.kind === "context" || line.kind === "del"
  );
  const newSide = lines.filter(
    (line) => line.kind === "context" || line.kind === "add"
  );
  const tokens: TokenMaps =
    lines.length > MAX_HIGHLIGHT_LINES
      ? { old: new Map(), new: new Map() }
      : {
          old: tokenizeSide(oldSide, lang, options.themeName),
          new: tokenizeSide(newSide, lang, options.themeName),
        };

  const toolbar =
    `<div class="mdprv-diff-toolbar" role="group" aria-label="Modo de visualização do diff">` +
    `<button type="button" class="mdprv-diff-btn" data-diff-view-target="inline" aria-pressed="true">Inline</button>` +
    `<button type="button" class="mdprv-diff-btn" data-diff-view-target="split" aria-pressed="false">Lado a lado</button>` +
    `</div>`;

  return (
    `<div class="mdprv-diff" data-diff-view="inline">` +
    toolbar +
    inlineTable(lines, tokens) +
    splitTable(lines, tokens) +
    `</div>`
  );
}
