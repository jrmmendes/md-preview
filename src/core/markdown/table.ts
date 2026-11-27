/**
 * Server-side markup for interactive tables.
 *
 * GFM tables keep their original `<table>` (and are usable without JS); the
 * renderer only wraps them with the spreadsheet shell and a toolbar that stays
 * hidden until the island boots. A ```csv fence reuses the same shell with the
 * parsed CSV rendered as the table body. Both kinds can expose the original
 * source in the per-block Raw view.
 */

import { COPY_ICON, CSV_ICON } from "../../shared/copy-icons";
import {
  isNumericColumn,
  parseCsv,
  type TableModel,
} from "../../shared/table";

export type TableKind = "gfm" | "csv";

export interface CsvRenderOptions {
  /** Per-document sequence used to build unique ids for the table and toolbar. */
  seq: number;
  /**
   * Highlights the original fence body for the per-block Raw toggle. The
   * returned markup is trusted server HTML; when it is empty a plain escaped
   * `<pre>` is used so Raw never disappears.
   */
  renderSource?: (source: string) => string;
}

const FILTER_ICON =
  '<span class="mdprv-icon" data-icon="filter" aria-hidden="true"></span>';

const PIVOT_ICON =
  '<span class="mdprv-icon" data-icon="pivot" aria-hidden="true"></span>';

const FULLSCREEN_ICON =
  '<span class="mdprv-icon" data-icon="fullscreen" aria-hidden="true"></span>';

const CHART_ICON =
  '<span class="mdprv-icon" data-icon="chart" aria-hidden="true"></span>';

/** Table with its first row highlighted: toggles the header row. */
const HEADER_ROW_ICON =
  '<span class="mdprv-icon" data-icon="header-row" aria-hidden="true"></span>';

/** Table with its first column highlighted: toggles the header column. */
const HEADER_COL_ICON =
  '<span class="mdprv-icon" data-icon="header-col" aria-hidden="true"></span>';

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toolbarHtml(id: string, withRaw: boolean): string {
  const rawButton = withRaw
    ? '<button type="button" class="mdprv-table-btn mdprv-table-btn--label" data-mdprv-table-action="raw" aria-pressed="false">Raw</button>'
    : "";
  // The Raw toggle leads the toolbar (left of the search magnifier), and the
  // filter field sits next to it; the icon actions are pushed to the right end
  // by table.css, so the flexible space stays in the middle.
  return (
    `<div class="mdprv-table-toolbar${withRaw ? " mdprv-table-toolbar--raw" : ""}" data-mdprv-table-toolbar hidden>` +
    rawButton +
    `<div class="mdprv-table-searchbar">` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="filter" aria-expanded="false" aria-controls="${id}-search" aria-label="Pesquisar linhas" title="Pesquisar linhas">${FILTER_ICON}</button>` +
    `<div class="mdprv-table-search" id="${id}-search" data-mdprv-table-filter data-open="false">` +
    `<input type="search" data-mdprv-table-filter-input tabindex="-1" aria-controls="${id}-grid" placeholder="Filtrar linhas…" aria-label="Filtrar linhas da tabela">` +
    `</div>` +
    `</div>` +
    `<span class="mdprv-table-count" data-mdprv-table-count role="status" aria-live="polite"></span>` +
    `<div class="mdprv-table-tools" role="group" aria-label="Controles da tabela">` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="header-row" aria-pressed="true" aria-label="Usar 1ª linha como cabeçalho" title="Usar 1ª linha como cabeçalho">${HEADER_ROW_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="header-col" aria-pressed="false" aria-label="Usar 1ª coluna como cabeçalho" title="Usar 1ª coluna como cabeçalho">${HEADER_COL_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn mdprv-table-btn--pivot" data-mdprv-table-action="pivot" aria-pressed="false" aria-label="Pivotar tabela" title="Pivotar tabela">${PIVOT_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="chart" aria-pressed="false" aria-haspopup="dialog" aria-expanded="false" aria-label="Visualizar como gráfico" title="Visualizar como gráfico">${CHART_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="copy" aria-label="Copiar tabela como Markdown" title="Copiar tabela como Markdown">${COPY_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="copy-csv" aria-label="Copiar tabela como CSV" title="Copiar tabela como CSV">${CSV_ICON}</button>` +
    `<button type="button" class="mdprv-table-btn" data-mdprv-table-action="fullscreen" aria-label="Abrir tabela em tela cheia" title="Abrir tabela em tela cheia">${FULLSCREEN_ICON}</button>` +
    `</div>` +
    `</div>`
  );
}

function sheetOpenHtml(): string {
  return (
    `<div class="mdprv-sheet" data-mdprv-sheet>` +
    `<div class="mdprv-sheet-corner" aria-hidden="true"></div>` +
    `<div class="mdprv-sheet-colhead" data-mdprv-colhead role="row" aria-label="Colunas"><div class="mdprv-sheet-track" data-mdprv-colhead-track></div></div>` +
    `<div class="mdprv-sheet-rowhead" data-mdprv-rowhead role="row" aria-label="Linhas"><div class="mdprv-sheet-track" data-mdprv-rowhead-track></div></div>` +
    `<div class="mdprv-sheet-body" data-mdprv-sheet-body>`
  );
}

function sheetCloseHtml(): string {
  return `</div></div>`;
}

/** Trusted HTML for a per-block Raw view: highlighted source, else escaped text. */
export function renderTableRawHtml(source: string, highlighted: string): string {
  return highlighted.trim() !== ""
    ? highlighted
    : `<pre class="mdprv-table-raw-pre"><code>${escapeText(source)}</code></pre>`;
}

function rawViewHtml(rawHtml: string): string {
  return `<div class="mdprv-table-raw" data-mdprv-table-raw-view hidden>${rawHtml}</div>`;
}

function shellEndHtml(): string {
  return (
    `<div class="mdprv-table-chart" data-mdprv-chart-container hidden></div>` +
    `<p class="mdprv-table-empty" data-mdprv-table-empty hidden>Nenhuma linha corresponde ao filtro.</p>` +
    `<div class="mdprv-table-status" data-mdprv-table-status role="status" aria-live="polite"></div>` +
    `</div>`
  );
}

export interface GfmRenderOptions {
  /**
   * Trusted HTML with the original Markdown lines of the table, used by the
   * per-block Raw toggle. Empty (no source available) omits the toggle.
   */
  rawHtml?: string;
}

/** Prefix emitted before the GFM `<table>` token. */
export function renderGfmTableOpen(seq: number, options: GfmRenderOptions = {}): string {
  const id = `mdprv-table-${seq}`;
  const raw = options.rawHtml ?? "";
  return (
    `<div class="mdprv-table" data-mdprv-table data-mdprv-table-id="${id}" ` +
    `data-mdprv-table-kind="gfm" data-mdprv-table-header-row="1" ` +
    `data-mdprv-table-header-col="0" data-mdprv-table-pivot="0"` +
    (raw === "" ? "" : ` data-mdprv-table-raw="0"`) +
    `>` +
    toolbarHtml(id, raw !== "") +
    sheetOpenHtml()
  );
}

/** Suffix emitted after the GFM `</table>` token. */
export function renderGfmTableClose(options: GfmRenderOptions = {}): string {
  const raw = options.rawHtml ?? "";
  return sheetCloseHtml() + (raw === "" ? "" : rawViewHtml(raw)) + shellEndHtml();
}

function renderCsvRows(model: TableModel, numeric: boolean[]): string {
  const lines: string[] = [];
  for (let index = 0; index < model.rows.length; index += 1) {
    const row = model.rows[index]!;
    const cells = row.map((cell, column) => {
      const numericAttr = numeric[column] && cell.trim() !== "" ? ' data-mdprv-num="1"' : "";
      return `<td role="gridcell" aria-colindex="${column + 1}"${numericAttr}>${escapeText(cell)}</td>`;
    });
    lines.push(
      `<tr role="row" aria-rowindex="${index + 2}">${cells.join("")}</tr>`
    );
  }
  return lines.join("");
}

function renderCsvTableHtml(model: TableModel, id: string): string {
  const numeric = model.header.map((_, column) =>
    isNumericColumn(model.rows.map((row) => row[column] ?? ""))
  );
  const header = model.header
    .map(
      (cell, column) =>
        `<th role="columnheader" scope="col" aria-colindex="${column + 1}">${escapeText(cell)}</th>`
    )
    .join("");
  return (
    `<table class="mdprv-grid" id="${id}-grid" role="grid" aria-label="Tabela CSV" ` +
    `aria-rowcount="${model.rows.length + 1}" aria-colcount="${model.header.length}">` +
    `<thead><tr role="row" aria-rowindex="1">${header}</tr></thead>` +
    `<tbody>${renderCsvRows(model, numeric)}</tbody>` +
    `</table>`
  );
}

/**
 * Render a ```csv fence. Returns `null` for empty/malformed input so the
 * caller can fall back to a regular highlighted code block.
 */
export function renderCsvTable(source: string, options: CsvRenderOptions): string | null {
  const model = parseCsv(source);
  if (!model) {
    return null;
  }
  const id = `mdprv-table-${options.seq}`;
  const highlighted = options.renderSource?.(source) ?? "";
  const rawHtml = renderTableRawHtml(source, highlighted);
  return (
    `<div class="mdprv-table" data-mdprv-table data-mdprv-table-id="${id}" ` +
    `data-mdprv-table-kind="csv" data-mdprv-table-header-row="1" ` +
    `data-mdprv-table-header-col="0" data-mdprv-table-pivot="0" data-mdprv-table-raw="0">` +
    toolbarHtml(id, true) +
    sheetOpenHtml() +
    renderCsvTableHtml(model, id) +
    sheetCloseHtml() +
    rawViewHtml(rawHtml) +
    shellEndHtml()
  );
}
