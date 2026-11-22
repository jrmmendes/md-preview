/**
 * Progressive enhancement for server-rendered tables (GFM and ```csv).
 *
 * The server already emits a valid, readable table plus the spreadsheet shell
 * with a hidden toolbar. This island adds the sheet gutters, selection, keyboard
 * navigation, resize/autofit, per-column value funnels, global search, sorting,
 * pivoting, clipboard output and the fullscreen dialog. Table state lives only
 * in memory for the lifetime of the page, except the frame size chosen with the
 * fullscreen resize handles, which is kept in sessionStorage per document and
 * table (see `lightboxSizeKey`), so a reload restores it but a new tab starts
 * from the default size.
 */

import {
  buildChartData,
  buildColumnValues,
  chartUnavailableReason,
  clampColumnWidth,
  columnLetter,
  filterRows,
  isNumericColumn,
  normalizeCellText,
  normalizeRange,
  normalizeValueKey,
  numericChartColumns,
  pivotTable,
  resolveRawMode,
  serializeCsv,
  serializeMarkdownTable,
  serializeTsv,
  sortOrder,
  TABLE_COLLATOR,
  TABLE_MIN_COLUMN_WIDTH,
  type ChartColumn,
  type ChartData,
  type ChartKind,
  type SortDirection,
  type TableAlign,
  type TableModel,
  type TableRange,
  type TableValue,
} from "../../shared/table";
import { CSV_ICON } from "../../shared/copy-icons";
import { copyText, flashCopied, flashCopyError } from "./clipboard";
import {
  CHART_KIND_LABELS,
  CHART_PREVIEWS,
  chartPaletteTokens,
  renderChart,
} from "./table-chart";

interface CellPosition {
  r: number;
  c: number;
}

interface ViewModel {
  labels: string[];
  /** Original inline HTML of the header cells (null for transposed views). */
  headerHtml: string[] | null;
  rows: string[][];
  /** Original cell HTML (null when the view was generated from text). */
  rowsHtml: string[][] | null;
  align: TableAlign[];
  normalized: string[][];
  numeric: boolean[];
}

interface TableState {
  headerRow: boolean;
  headerCol: boolean;
  filter: string;
  pivot: boolean;
  colFilters: Map<number, Set<string>>;
  sortColumn: number | null;
  sortDirection: SortDirection | null;
  active: CellPosition | null;
  anchor: CellPosition | null;
  ranges: TableRange[];
  dragging: boolean;
  raw: boolean;
  globalRaw: boolean;
}

interface TableController {
  block: HTMLElement;
  sync(): void;
  naturalWidth(): number;
  reposition(): void;
  closePopover(refocus: boolean): void;
  popoverOpen(): boolean;
  chartPopoverOpen(): boolean;
  closeChartPopover(refocus: boolean): void;
  setGlobalRaw(raw: boolean): void;
}

const SORT_ICON =
  '<svg class="mdprv-table-sort-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>';

const FUNNEL_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h18l-7 8v7l-4 2v-9z"></path></svg>';

const FUNNEL_BADGE =
  '<span class="mdprv-table-fcount" aria-hidden="true" hidden></span>';

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg>';

const LIGHTBOX_MIN_ZOOM = 0.6;
const LIGHTBOX_MAX_ZOOM = 2.2;
const LIGHTBOX_STEP = 0.15;
/**
 * sessionStorage key prefix for the fullscreen frame size.
 *
 * The full key is `mdprv:table-lb:v1:<pathname>:<tableId>`: the version lives in
 * the key, the document in the pathname and the block in `data-mdprv-table-id`.
 * sessionStorage is deliberate — closing the tab drops the value and a fresh
 * tab/session opens at the default size, while a reload keeps it.
 */
const LIGHTBOX_STORAGE_PREFIX = "mdprv:table-lb:v1:";
/** Rejects absurd/stale pixel values written by older or corrupted sessions. */
const LIGHTBOX_STORAGE_MAX_PX = 100_000;
const ROW_HEIGHT_FALLBACK = 26;

const CONTROLLERS = new Map<HTMLElement, TableController>();
const POPOVER_CLOSERS = new Set<(refocus: boolean) => void>();

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function debounce(fn: () => void, wait: number): () => void {
  let timer = 0;
  return () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(fn, wait);
  };
}

function zoomFactor(element: HTMLElement): number {
  const value = Number.parseFloat(window.getComputedStyle(element).zoom);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function headerChrome(label: string, html: string | null): HTMLElement {
  const head = document.createElement("span");
  head.className = "mdprv-table-head";
  const sort = document.createElement("span");
  sort.className = "mdprv-table-sort";
  const text = document.createElement("span");
  text.className = "mdprv-table-head-label";
  if (html === null) {
    text.textContent = label;
  } else {
    text.innerHTML = html;
  }
  sort.append(text);
  sort.insertAdjacentHTML("beforeend", SORT_ICON);
  head.append(sort);
  return head;
}

function setCellAttributes(
  cell: HTMLTableCellElement,
  role: "gridcell" | "rowheader" | "columnheader",
  column: number,
  tabbable: boolean
): void {
  cell.setAttribute("role", role);
  cell.setAttribute("aria-colindex", String(column + 1));
  cell.setAttribute("aria-selected", "false");
  cell.tabIndex = tabbable ? 0 : -1;
  if (role === "rowheader") {
    cell.setAttribute("scope", "row");
  } else if (role === "columnheader") {
    cell.setAttribute("scope", "col");
  }
}

function rangeFrom(anchor: CellPosition, target: CellPosition): TableRange {
  return normalizeRange({ r1: anchor.r, c1: anchor.c, r2: target.r, c2: target.c });
}

function setupTable(block: HTMLElement): TableController | null {
  if (block.dataset.mdprvTableReady === "1") {
    return CONTROLLERS.get(block) ?? null;
  }
  const table = block.querySelector<HTMLTableElement>("table");
  const toolbar = block.querySelector<HTMLElement>("[data-mdprv-table-toolbar]");
  const searchWrap = block.querySelector<HTMLElement>("[data-mdprv-table-filter]");
  const filterInput = block.querySelector<HTMLInputElement>("[data-mdprv-table-filter-input]");
  const countEl = block.querySelector<HTMLElement>("[data-mdprv-table-count]");
  const emptyEl = block.querySelector<HTMLElement>("[data-mdprv-table-empty]");
  const statusEl = block.querySelector<HTMLElement>("[data-mdprv-table-status]");
  const colhead = block.querySelector<HTMLElement>("[data-mdprv-colhead]");
  const rowhead = block.querySelector<HTMLElement>("[data-mdprv-rowhead]");
  const colheadTrack = block.querySelector<HTMLElement>("[data-mdprv-colhead-track]");
  const rowheadTrack = block.querySelector<HTMLElement>("[data-mdprv-rowhead-track]");
  const sheetBody = block.querySelector<HTMLElement>("[data-mdprv-sheet-body]");
  const rawView = block.querySelector<HTMLElement>("[data-mdprv-table-raw-view]");
  if (
    !table ||
    !toolbar ||
    !searchWrap ||
    !filterInput ||
    !countEl ||
    !emptyEl ||
    !colhead ||
    !rowhead ||
    !colheadTrack ||
    !rowheadTrack ||
    !sheetBody
  ) {
    return null;
  }

  if (!table.tHead) {
    table.insertBefore(document.createElement("thead"), table.firstChild);
  }
  if (!table.tBodies[0]) {
    table.append(document.createElement("tbody"));
  }
  const thead = table.tHead!;
  const tbody = table.tBodies[0]!;

  const filterButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="filter"]'
  );
  const headerRowButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="header-row"]'
  );
  const headerColButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="header-col"]'
  );
  const pivotButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="pivot"]'
  );
  const copyButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="copy"]'
  );
  const csvButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="copy-csv"]'
  );
  const chartButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="chart"]'
  );
  const chartContainer = block.querySelector<HTMLElement>("[data-mdprv-chart-container]");
  const fullscreenButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="fullscreen"]'
  );
  const rawButton = block.querySelector<HTMLButtonElement>(
    '[data-mdprv-table-action="raw"]'
  );

  const state: TableState = {
    headerRow: block.getAttribute("data-mdprv-table-header-row") === "1",
    headerCol: block.getAttribute("data-mdprv-table-header-col") === "1",
    filter: "",
    pivot: false,
    colFilters: new Map(),
    sortColumn: null,
    sortDirection: null,
    active: null,
    anchor: null,
    ranges: [],
    dragging: false,
    raw: false,
    globalRaw: document.documentElement.classList.contains("mdprv-raw-open"),
  };

  /* ---------- immutable base snapshot and current view ---------- */
  const headerCells = (): HTMLTableCellElement[] => {
    const row = thead.rows[0];
    return row ? Array.from(row.cells) : [];
  };

  const baseLabels = headerCells().map((cell) => textOf(cell));
  const baseHeaderHtml = headerCells().map((cell) => cell.innerHTML);
  const baseAlign = headerCells().map<TableAlign>((cell) => {
    const value = cell.style.textAlign;
    return value === "left" || value === "center" || value === "right" ? value : null;
  });
  const baseRows = Array.from(tbody.rows).map((row) =>
    Array.from(row.cells).map((cell) => textOf(cell))
  );
  const baseRowsHtml = Array.from(tbody.rows).map((row) =>
    Array.from(row.cells).map((cell) => cell.innerHTML)
  );

  const baseView: ViewModel = {
    labels: baseLabels,
    headerHtml: baseHeaderHtml,
    rows: baseRows,
    rowsHtml: baseRowsHtml,
    align: baseAlign,
    normalized: baseRows.map((row) => row.map((cell) => normalizeCellText(cell))),
    numeric: baseLabels.map((_, column) =>
      isNumericColumn(baseRows.map((row) => row[column] ?? ""))
    ),
  };
  let view: ViewModel = baseView;
  let valueCache = new Map<number, TableValue[]>();
  let rowHeights = new WeakMap<HTMLTableRowElement, number>();
  let baseWidths: string[] | null = null;
  let pivotWidths: string[] | null = null;
  let pivotSaved: {
    headerRow: boolean;
    headerCol: boolean;
    sortColumn: number | null;
    sortDirection: SortDirection | null;
  } | null = null;
  let rafSync = 0;
  let rafPosition = 0;
  let suppressColheadClick = false;
  let popover: HTMLElement | null = null;
  let popoverCol: number | null = null;
  let popoverFunnel: HTMLButtonElement | null = null;
  let popoverTitle: HTMLElement | null = null;
  let popoverSearch: HTMLInputElement | null = null;
  let popoverList: HTMLElement | null = null;
  let popoverEmpty: HTMLElement | null = null;

  /* ---------- chart state ---------- */
  let chartPopover: HTMLElement | null = null;
  let chartAnchor: HTMLButtonElement | null = null;
  let chartKind: ChartKind = "bar";
  let chartValueColumn: number | null = null;
  let chartActive = false;
  let chartColumns: ChartColumn[] = [];
  let chartCurrentData: ChartData | null = null;

  const announce = (message: string): void => {
    if (statusEl) {
      statusEl.textContent = message;
    }
  };

  /** GFM tables have no per-block raw view; the document-wide Raw covers them. */
  const rawMode = () =>
    rawView
      ? resolveRawMode(state.raw, state.globalRaw)
      : { raw: false, locked: false };

  const naturalWidth = (): number => {
    const cols = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
    let total = 0;
    cols.forEach((col) => {
      const width = Number.parseFloat(col.style.width);
      if (Number.isFinite(width)) {
        total += width;
      }
    });
    if (total === 0) {
      total = table.getBoundingClientRect().width / zoomFactor(block);
    }
    const gutter = block.querySelector<HTMLElement>("[data-mdprv-rowhead]");
    if (gutter) {
      total += gutter.getBoundingClientRect().width / zoomFactor(block);
    }
    if (chartActive) {
      // The chart's viewBox is 720px wide; keep the fullscreen frame at least
      // that wide so the plot is never squeezed by a narrow table.
      total = Math.max(total, 720);
    }
    return Math.ceil(total + 2);
  };

  const syncLightboxGeometry = (): void => {
    if (lightboxBlock !== block) {
      return;
    }
    const next = naturalWidth();
    // Column resizing changes the natural width. Keep a user-resized viewport
    // growing by the same delta instead of snapping back to "fit".
    const manuallySized =
      lightboxWidth !== null &&
      lightboxBaseWidth > 0 &&
      Math.abs(lightboxWidth - lightboxBaseWidth) > 0.5;
    lightboxWidth = manuallySized
      ? Math.max(1, (lightboxWidth ?? next) + (next - lightboxBaseWidth))
      : next;
    lightboxBaseWidth = next;
    applyLightboxSize();
    window.requestAnimationFrame(() => {
      fitToStage();
      syncHandleAria();
    });
  };

  const applyCellAlignment = (
    cell: HTMLTableCellElement,
    column: number,
    numeric: boolean
  ): void => {
    cell.style.textAlign = numeric ? "" : view.align[column] ?? "";
  };

  /* ---------- geometry helpers ---------- */
  const dataRows = (): HTMLTableRowElement[] =>
    Array.from(tbody.rows).filter((row) => row.dataset.mdprvOrigIndex !== undefined);

  const rowCount = (): number => tbody.rows.length;

  const colElements = (): HTMLTableCellElement[] => {
    const head = headerCells();
    if (head.length > 0) {
      return head;
    }
    const first = tbody.rows[0];
    return first ? Array.from(first.cells) : [];
  };

  const colCount = (): number => colElements().length;

  const rowIndexOf = (row: HTMLTableRowElement): number => {
    if (row.parentElement === thead) {
      return 0;
    }
    return row.sectionRowIndex + 1;
  };

  const cellAt = (r: number, c: number): HTMLTableCellElement | null => {
    if (r === 0) {
      const row = thead.rows[0];
      return row ? row.cells[c] ?? null : null;
    }
    const row = tbody.rows[r - 1];
    return row ? row.cells[c] ?? null : null;
  };

  const currentWidths = (): string[] => {
    if (state.pivot) {
      if (!pivotWidths) {
        pivotWidths = [];
      }
      return pivotWidths;
    }
    if (!baseWidths) {
      baseWidths = [];
    }
    return baseWidths;
  };

  const applyWidths = (): void => {
    const widths = currentWidths();
    const cols = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
    cols.forEach((col, index) => {
      col.style.width = widths[index] ?? "";
    });
  };

  const measureText = (element: Element): number => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().width;
  };

  const measureColumnWidth = (index: number): number => {
    const head = headerCells()[index];
    const label = head?.querySelector<HTMLElement>(".mdprv-table-head-label") ?? head;
    let widest = label ? measureText(label) : 0;
    if (head) {
      widest += 41; // sort arrow + funnel + gaps
    }
    const rows = dataRows().slice(0, 40);
    for (const row of rows) {
      const cell = row.cells[index];
      if (cell) {
        widest = Math.max(widest, measureText(cell));
      }
    }
    const styleSource = head ?? dataRows()[0]?.cells[index];
    let padding = 16;
    if (styleSource) {
      const style = window.getComputedStyle(styleSource);
      padding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
    }
    return Math.round(clampColumnWidth(widest + padding + 2, 80, 340));
  };

  const ensureColgroup = (): void => {
    const columns = Math.max(
      view.labels.length,
      view.rows.reduce((widest, row) => Math.max(widest, row.length), 0)
    );
    const existing = table.querySelector<HTMLTableColElement>("colgroup");
    if (!existing || existing.children.length !== columns) {
      const colgroup = document.createElement("colgroup");
      for (let index = 0; index < columns; index += 1) {
        colgroup.append(document.createElement("col"));
      }
      if (existing) {
        existing.replaceWith(colgroup);
      } else {
        table.insertBefore(colgroup, table.firstChild);
      }
    }
    const widths = currentWidths();
    if (widths.length !== columns || widths.every((width) => width === "")) {
      widths.length = 0;
      for (let index = 0; index < columns; index += 1) {
        widths.push(`${measureColumnWidth(index)}px`);
      }
    }
    applyWidths();
  };

  const setColumnWidth = (index: number, pixels: number): void => {
    const cols = table.querySelectorAll<HTMLTableColElement>("colgroup > col");
    const col = cols[index];
    if (!col) {
      return;
    }
    const value = `${Math.round(clampColumnWidth(pixels))}px`;
    col.style.width = value;
    const widths = currentWidths();
    widths[index] = value;
  };

  const autoFitColumn = (index: number): void => {
    const cells = table.querySelectorAll<HTMLTableCellElement>(
      `tr > *:nth-child(${index + 1})`
    );
    let widest = 0;
    const z = zoomFactor(block);
    for (const cell of cells) {
      if (cell.closest("tr[hidden]")) {
        continue;
      }
      const style = window.getComputedStyle(cell);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);
      const label = cell.querySelector<HTMLElement>(".mdprv-table-head-label");
      const range = document.createRange();
      range.selectNodeContents(label ?? cell);
      let width = range.getBoundingClientRect().width / z + padding;
      if (cell.querySelector(".mdprv-table-head")) {
        width += 41;
      }
      widest = Math.max(widest, width);
    }
    if (widest > 0) {
      setColumnWidth(index, widest + 2);
    }
  };

  /* ---------- gutters ---------- */
  const buildColHead = (): void => {
    colheadTrack.replaceChildren();
    const cols = colCount();
    const tags: HTMLElement[] = [];
    for (let column = 0; column < cols; column += 1) {
      const tag = document.createElement("span");
      tag.className = "mdprv-sheet-tag";
      tag.setAttribute("role", "columnheader");
      tag.setAttribute("data-mdprv-col", String(column));
      tag.setAttribute("data-mdprv-selected", "false");
      tag.tabIndex = 0;
      tag.setAttribute("aria-label", `Selecionar coluna ${columnLetter(column)}`);
      tag.textContent = columnLetter(column);
      colheadTrack.append(tag);
      tags.push(tag);
    }
    for (let column = 0; column < cols - 1; column += 1) {
      const handle = document.createElement("span");
      handle.className = "mdprv-sheet-resize";
      handle.setAttribute("role", "separator");
      handle.tabIndex = 0;
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", `Redimensionar coluna ${columnLetter(column + 1)}`);
      handle.setAttribute("data-mdprv-col", String(column));
      tags[column]?.append(handle);
    }
  };

  const appendRowTag = (logical: number, label: string): void => {
    const tag = document.createElement("span");
    tag.className = "mdprv-sheet-tag";
    tag.setAttribute("role", "rowheader");
    tag.setAttribute("data-mdprv-row", String(logical));
    tag.setAttribute("data-mdprv-selected", "false");
    tag.tabIndex = 0;
    tag.setAttribute("aria-label", `Selecionar linha ${label}`);
    tag.textContent = label;
    rowheadTrack.append(tag);
  };

  const buildRowHead = (): void => {
    rowheadTrack.replaceChildren();
    let display = 0;
    if (thead.rows[0]?.cells.length) {
      appendRowTag(0, String(display + 1));
      display += 1;
    }
    const rows = Array.from(tbody.rows);
    rows.forEach((row, index) => {
      if (row.hidden) {
        return;
      }
      appendRowTag(index + 1, String(display + 1));
      display += 1;
    });
  };

  const syncGutterScroll = (): void => {
    colheadTrack.style.transform = `translateX(${-sheetBody.scrollLeft}px)`;
    rowheadTrack.style.transform = `translateY(${-sheetBody.scrollTop}px)`;
  };

  const syncGutterSizes = (): void => {
    if (state.raw) {
      return;
    }
    const z = zoomFactor(block);
    const cols = colElements();
    Array.from(colheadTrack.children).forEach((tag, index) => {
      const column = cols[index];
      if (!column) {
        return;
      }
      const width = column.getBoundingClientRect().width / z;
      (tag as HTMLElement).style.width = `${Math.max(35, width)}px`;
      const handle = tag.querySelector<HTMLElement>(".mdprv-sheet-resize");
      if (handle) {
        handle.setAttribute("aria-valuenow", String(Math.round(width)));
      }
    });

    const headRow = thead.rows[0] ?? null;
    for (const tag of Array.from(rowheadTrack.children) as HTMLElement[]) {
      const logical = Number(tag.getAttribute("data-mdprv-row"));
      const row = logical === 0 ? headRow : tbody.rows[logical - 1] ?? null;
      if (!row) {
        continue;
      }
      let height = rowHeights.get(row);
      if (height === undefined) {
        height = row.getBoundingClientRect().height / z;
        if (height > 0) {
          rowHeights.set(row, height);
        }
      }
      tag.style.height = `${Math.max(ROW_HEIGHT_FALLBACK, height ?? 0)}px`;
    }
    syncGutterScroll();
  };

  const requestSync = (): void => {
    if (rafSync) {
      return;
    }
    rafSync = window.requestAnimationFrame(() => {
      rafSync = 0;
      syncGutterSizes();
    });
  };

  const buildSheetChrome = (): void => {
    buildColHead();
    buildRowHead();
    requestSync();
  };

  /* ---------- view rendering ---------- */
  const numericFor = (column: number): boolean =>
    isNumericColumn(view.rows.map((row) => row[column] ?? ""));

  const defaultActive = (): CellPosition | null => {
    const preferred = state.headerRow ? { r: 0, c: 0 } : { r: 1, c: 0 };
    return cellAt(preferred.r, preferred.c) ? preferred : null;
  };

  /**
   * Roving entry point for the grid when nothing is selected. Prefers the first
   * body cell (data row, or the stray header row when the first line is not a
   * header) and falls back to the column header, so Tab can always reach the
   * grid without leaving a cell highlighted at boot.
   */
  const entryPosition = (): CellPosition | null => {
    const rows = Array.from(tbody.rows);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      if (row.hidden || row.cells.length === 0) {
        continue;
      }
      return { r: index + 1, c: 0 };
    }
    if (cellAt(0, 0)) {
      return { r: 0, c: 0 };
    }
    return null;
  };

  const paint = (): void => {
    table
      .querySelectorAll<HTMLElement>(
        "[role='gridcell'], [role='rowheader'], [role='columnheader']"
      )
      .forEach((cell) => {
        cell.setAttribute("aria-selected", "false");
        cell.classList.remove("mdprv-active", "mdprv-anchor");
      });
    colheadTrack.querySelectorAll<HTMLElement>("[data-mdprv-col]").forEach((tag) => {
      tag.setAttribute("data-mdprv-selected", "false");
    });
    rowheadTrack.querySelectorAll<HTMLElement>("[data-mdprv-row]").forEach((tag) => {
      tag.setAttribute("data-mdprv-selected", "false");
    });

    const selectedColumns = new Set<number>();
    const selectedRows = new Set<number>();
    for (const range of state.ranges) {
      for (let r = range.r1; r <= range.r2; r += 1) {
        selectedRows.add(r);
        for (let c = range.c1; c <= range.c2; c += 1) {
          selectedColumns.add(c);
          cellAt(r, c)?.setAttribute("aria-selected", "true");
        }
      }
    }

    if (state.active) {
      cellAt(state.active.r, state.active.c)?.classList.add("mdprv-active");
    }
    if (state.anchor) {
      cellAt(state.anchor.r, state.anchor.c)?.classList.add("mdprv-anchor");
    }

    colheadTrack.querySelectorAll<HTMLElement>("[data-mdprv-col]").forEach((tag) => {
      const column = Number(tag.getAttribute("data-mdprv-col"));
      tag.setAttribute("data-mdprv-selected", selectedColumns.has(column) ? "true" : "false");
    });
    rowheadTrack.querySelectorAll<HTMLElement>("[data-mdprv-row]").forEach((tag) => {
      const row = Number(tag.getAttribute("data-mdprv-row"));
      tag.setAttribute("data-mdprv-selected", selectedRows.has(row) ? "true" : "false");
    });

    table
      .querySelectorAll<HTMLElement>(
        "[role='gridcell'], [role='rowheader'], [role='columnheader']"
      )
      .forEach((cell) => {
        cell.tabIndex = -1;
      });
    const stop = state.active ?? entryPosition();
    if (stop) {
      const cell = cellAt(stop.r, stop.c);
      if (cell) {
        cell.tabIndex = 0;
      }
    }
    updateToolbarState();
  };

  const clearSelection = (): void => {
    state.ranges = [];
    state.active = null;
    state.anchor = null;
    paint();
  };

  const setActive = (r: number, c: number, extend: boolean): void => {
    if (!cellAt(r, c)) {
      return;
    }
    if (extend && state.anchor) {
      state.ranges = [rangeFrom(state.anchor, { r, c })];
    } else if (!extend) {
      state.ranges = [{ r1: r, c1: c, r2: r, c2: c }];
      state.anchor = { r, c };
    }
    state.active = { r, c };
    paint();
  };

  const addRange = (r: number, c: number): void => {
    state.ranges.push({ r1: r, c1: c, r2: r, c2: c });
    state.active = { r, c };
    state.anchor = { r, c };
    paint();
  };

  const buildHeaderRow = (): HTMLTableRowElement => {
    const tr = document.createElement("tr");
    tr.setAttribute("role", "row");
    tr.setAttribute("aria-rowindex", "1");
    view.labels.forEach((label, index) => {
      const th = document.createElement("th");
      setCellAttributes(th, "columnheader", index, true);
      th.setAttribute("aria-sort", "none");
      th.style.textAlign = view.align[index] ?? "";
      th.append(headerChrome(label, view.headerHtml?.[index] ?? null));
      tr.append(th);
    });
    return tr;
  };

  const buildStrayHeaderRow = (): HTMLTableRowElement => {
    const tr = document.createElement("tr");
    tr.setAttribute("role", "row");
    tr.setAttribute("aria-rowindex", "1");
    tr.dataset.mdprvHeaderRow = "1";
    view.labels.forEach((label, index) => {
      const rowHeader = state.headerCol && index === 0;
      const cell = document.createElement(rowHeader ? "th" : "td");
      setCellAttributes(cell, rowHeader ? "rowheader" : "gridcell", index, false);
      const html = view.headerHtml?.[index];
      if (html === undefined || html === null) {
        cell.textContent = label;
      } else {
        cell.innerHTML = html;
      }
      applyCellAlignment(cell, index, false);
      tr.append(cell);
    });
    return tr;
  };

  const buildDataRows = (): void => {
    view.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      tr.setAttribute("role", "row");
      tr.setAttribute("aria-rowindex", String(rowIndex + 2));
      row.forEach((value, column) => {
        const rowHeader = state.headerCol && column === 0;
        const cell = document.createElement(rowHeader ? "th" : "td");
        setCellAttributes(cell, rowHeader ? "rowheader" : "gridcell", column, false);
        if (!rowHeader && view.numeric[column]) {
          cell.setAttribute("data-mdprv-num", "1");
        }
        applyCellAlignment(cell, column, !rowHeader && view.numeric[column]);
        const html = view.rowsHtml?.[rowIndex]?.[column];
        if (html === undefined || html === null) {
          cell.textContent = value;
        } else {
          cell.innerHTML = html;
        }
        tr.append(cell);
      });
      tbody.append(tr);
    });
  };

  const decorateExistingRows = (): void => {
    Array.from(tbody.rows).forEach((row, rowIndex) => {
      row.setAttribute("role", "row");
      row.setAttribute("aria-rowindex", String(rowIndex + 2));
      row.dataset.mdprvOrigIndex = String(rowIndex);
      Array.from(row.cells).forEach((cell, column) => {
        const rowHeader = state.headerCol && column === 0;
        if (rowHeader && cell.tagName !== "TH") {
          const th = document.createElement("th");
          th.innerHTML = cell.innerHTML;
          setCellAttributes(th, "rowheader", column, false);
          cell.replaceWith(th);
          if (view.numeric[column]) {
            th.removeAttribute("data-mdprv-num");
          }
          return;
        }
        setCellAttributes(
          cell,
          rowHeader ? "rowheader" : "gridcell",
          column,
          false
        );
        if (!rowHeader && view.numeric[column]) {
          cell.setAttribute("data-mdprv-num", "1");
        } else {
          cell.removeAttribute("data-mdprv-num");
        }
        applyCellAlignment(cell, column, !rowHeader && view.numeric[column]);
      });
    });
  };

  const normalizeHeader = (): void => {
    const row = thead.rows[0];
    if (!row) {
      return;
    }
    Array.from(row.cells).forEach((cell, index) => {
      if (!cell.querySelector(".mdprv-table-head")) {
        const label = textOf(cell);
        cell.replaceChildren(headerChrome(label, cell.innerHTML));
      }
      setCellAttributes(cell, "columnheader", index, true);
      if (!cell.hasAttribute("aria-sort")) {
        cell.setAttribute("aria-sort", "none");
      }
      cell.style.textAlign = view.align[index] ?? "";
    });
  };

  const renderStructure = (resetSelection: boolean): void => {
    block.setAttribute("data-mdprv-table-pivot", state.pivot ? "1" : "0");
    block.setAttribute("data-mdprv-table-header-row", state.headerRow ? "1" : "0");
    block.setAttribute("data-mdprv-table-header-col", state.headerCol ? "1" : "0");

    thead.replaceChildren();
    tbody.replaceChildren();
    if (state.headerRow) {
      thead.append(buildHeaderRow());
    } else {
      tbody.append(buildStrayHeaderRow());
    }
    buildDataRows();

    Array.from(tbody.rows).forEach((row, index) => {
      if (row.dataset.mdprvHeaderRow === "1") {
        delete row.dataset.mdprvOrigIndex;
      } else {
        row.dataset.mdprvOrigIndex = String(index - (state.headerRow ? 0 : 1));
      }
    });

    table.setAttribute("aria-rowcount", String(view.rows.length + 1));
    table.setAttribute("aria-colcount", String(view.labels.length));
    valueCache = new Map();
    rowHeights = new WeakMap();
    ensureColgroup();
    if (resetSelection) {
      state.active = defaultActive();
      state.anchor = state.active;
      state.ranges = [];
    }
    buildSheetChrome();
  };

  /* ---------- sorting ---------- */
  const applySortOrder = (
    column: number | null,
    direction: SortDirection | null
  ): void => {
    state.sortColumn = column;
    state.sortDirection = direction;
    if (thead.rows[0]) {
      Array.from(thead.rows[0].cells).forEach((cell, index) => {
        if (index === column && direction === "asc") {
          cell.setAttribute("aria-sort", "ascending");
        } else if (index === column && direction === "desc") {
          cell.setAttribute("aria-sort", "descending");
        } else {
          cell.setAttribute("aria-sort", "none");
        }
      });
    }
    const rows = dataRows();
    const ordered =
      column === null || direction === null
        ? [...rows].sort(
            (a, b) =>
              Number(a.dataset.mdprvOrigIndex) - Number(b.dataset.mdprvOrigIndex)
          )
        : (() => {
            const order = sortOrder(view.rows, column, direction, {
              numeric: view.numeric[column],
              collator: TABLE_COLLATOR,
            });
            const byOriginal = new Map<number, HTMLTableRowElement>();
            for (const row of rows) {
              byOriginal.set(Number(row.dataset.mdprvOrigIndex), row);
            }
            return order
              .map((index) => byOriginal.get(index))
              .filter((row): row is HTMLTableRowElement => row !== undefined);
          })();
    const fragment = document.createDocumentFragment();
    for (const row of ordered) {
      fragment.append(row);
    }
    tbody.append(fragment);
    Array.from(tbody.rows).forEach((row, index) => {
      const rowIndex =
        row.dataset.mdprvHeaderRow === "1"
          ? 1
          : index + (state.headerRow ? 2 : 1);
      row.setAttribute("aria-rowindex", String(rowIndex));
    });
    buildRowHead();
    requestSync();
    if (chartActive) {
      refreshChart();
    }
  };

  const clearSort = (): void => {
    applySortOrder(null, null);
  };

  const cycleSort = (column: number): void => {
    if (!state.headerRow || state.pivot) {
      return;
    }
    if (state.sortColumn !== column) {
      applySortOrder(column, "asc");
    } else if (state.sortDirection === "asc") {
      applySortOrder(column, "desc");
    } else {
      applySortOrder(null, null);
    }
    const label = columnLabel(column);
    if (state.sortDirection === null) {
      announce(`Ordenação por ${label} removida.`);
    } else {
      announce(
        `Ordenado por ${label} em ordem ${
          state.sortDirection === "asc" ? "crescente" : "decrescente"
        }.`
      );
    }
  };

  /* ---------- value filters ---------- */
  const columnValues = (column: number): TableValue[] => {
    const cached = valueCache.get(column);
    if (cached) {
      return cached;
    }
    const values = buildColumnValues(
      view.rows.map((row) => row[column] ?? ""),
      TABLE_COLLATOR
    );
    valueCache.set(column, values);
    return values;
  };

  const hasValueFilters = (): boolean => state.colFilters.size > 0;

  const normalizeColumnFilter = (column: number): void => {
    const set = state.colFilters.get(column);
    if (!set) {
      return;
    }
    if (set.size >= columnValues(column).length) {
      state.colFilters.delete(column);
    }
  };

  const selectionFor = (column: number): Set<string> => {
    const set = state.colFilters.get(column);
    if (set) {
      return new Set(set);
    }
    return new Set(columnValues(column).map((item) => item.key));
  };

  const columnLabel = (column: number): string => {
    const cell = headerCells()[column];
    if (!cell) {
      return columnLetter(column);
    }
    const label = cell.querySelector<HTMLElement>(".mdprv-table-head-label");
    return textOf(label ?? cell) || columnLetter(column);
  };

  const updateFunnels = (): void => {
    if (!thead.rows[0]) {
      return;
    }
    Array.from(thead.rows[0].cells).forEach((cell, column) => {
      const button = cell.querySelector<HTMLButtonElement>(".mdprv-table-funnel");
      if (!button) {
        return;
      }
      const set = state.colFilters.get(column);
      const active = set !== undefined;
      const count = set?.size ?? 0;
      const open = popover !== null && !popover.hidden && popoverCol === column;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("data-active", active ? "true" : "false");
      const label =
        `Filtrar coluna ${columnLabel(column)}` +
        (active
          ? ` (${count} ${count === 1 ? "valor selecionado" : "valores selecionados"})`
          : " (todos os valores)");
      button.setAttribute("aria-label", label);
      button.title = label;
      const badge = button.querySelector<HTMLElement>(".mdprv-table-fcount");
      if (badge) {
        badge.hidden = !active;
        badge.textContent = active ? String(count) : "";
      }
    });
  };

  const syncFunnels = (): void => {
    if (!thead.rows[0]) {
      closePopover(false);
      return;
    }
    Array.from(thead.rows[0].cells).forEach((cell, column) => {
      const head = cell.querySelector<HTMLElement>(".mdprv-table-head");
      if (!head) {
        return;
      }
      let button = head.querySelector<HTMLButtonElement>(".mdprv-table-funnel");
      const allowed =
        state.headerRow && !(state.headerCol && column === 0) && !state.raw;
      if (!allowed) {
        button?.remove();
        return;
      }
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "mdprv-table-funnel";
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("data-mdprv-funnel", String(column));
        button.innerHTML = FUNNEL_ICON + FUNNEL_BADGE;
        head.append(button);
      }
    });
    updateFunnels();
  };

  /* ---------- popover ---------- */
  const ensurePopover = (): HTMLElement => {
    if (popover) {
      return popover;
    }
    const el = document.createElement("div");
    el.className = "mdprv-table-popover";
    el.setAttribute("role", "dialog");
    el.tabIndex = -1;
    el.hidden = true;
    el.innerHTML =
      '<p class="mdprv-table-pop-title" data-pop-title></p>' +
      '<input type="search" class="mdprv-table-pop-search" data-pop-search placeholder="Buscar valor…" aria-label="Buscar valor na coluna">' +
      '<ul class="mdprv-table-pop-list" role="group" data-pop-list aria-label="Valores da coluna"></ul>' +
      '<p class="mdprv-table-pop-empty" data-pop-empty hidden>Nenhum valor encontrado.</p>' +
      '<div class="mdprv-table-pop-actions">' +
      '<button type="button" data-pop-all>Selecionar todos</button>' +
      '<button type="button" data-pop-clear>Limpar</button>' +
      "</div>";
    document.body.append(el);
    popover = el;
    popoverTitle = el.querySelector("[data-pop-title]");
    popoverSearch = el.querySelector("[data-pop-search]");
    popoverList = el.querySelector("[data-pop-list]");
    popoverEmpty = el.querySelector("[data-pop-empty]");

    popoverSearch?.addEventListener("input", () => renderPopoverList());
    popoverSearch?.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusCheckbox(0);
      }
    });
    popoverList?.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || popoverCol === null) {
        return;
      }
      const set = selectionFor(popoverCol);
      if (target.checked) {
        set.add(target.value);
      } else {
        set.delete(target.value);
      }
      state.colFilters.set(popoverCol, set);
      normalizeColumnFilter(popoverCol);
      applyFilter();
    });
    popoverList?.addEventListener("keydown", (event) => {
      const boxes = visibleCheckboxes();
      if (boxes.length === 0) {
        return;
      }
      const index = boxes.indexOf(document.activeElement as HTMLInputElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusCheckbox(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusCheckbox(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusCheckbox(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusCheckbox(boxes.length - 1);
      }
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closePopover(true);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closePopover(true);
      }
    });
    el.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest("[data-pop-all]")) {
        if (popoverCol === null) {
          return;
        }
        const set = selectionFor(popoverCol);
        for (const box of visibleCheckboxes()) {
          set.add(box.value);
        }
        state.colFilters.set(popoverCol, set);
        normalizeColumnFilter(popoverCol);
        renderPopoverList();
        applyFilter();
        return;
      }
      if (target.closest("[data-pop-clear]")) {
        if (popoverCol === null) {
          return;
        }
        state.colFilters.delete(popoverCol);
        if (popoverSearch) {
          popoverSearch.value = "";
        }
        renderPopoverList();
        applyFilter();
      }
    });
    return el;
  };

  const visibleCheckboxes = (): HTMLInputElement[] => {
    if (!popoverList) {
      return [];
    }
    return Array.from(
      popoverList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    );
  };

  const focusCheckbox = (index: number): void => {
    const boxes = visibleCheckboxes();
    if (boxes.length === 0) {
      return;
    }
    const bounded = Math.max(0, Math.min(boxes.length - 1, index));
    boxes[bounded]?.focus();
  };

  const renderPopoverList = (): void => {
    if (!popover || popoverCol === null || !popoverList || !popoverEmpty || !popoverSearch) {
      return;
    }
    const query = normalizeCellText(popoverSearch.value);
    const selected = selectionFor(popoverCol);
    const fragment = document.createDocumentFragment();
    let shown = 0;
    for (const item of columnValues(popoverCol)) {
      if (query !== "" && !item.key.includes(query)) {
        continue;
      }
      shown += 1;
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = item.key;
      box.checked = selected.has(item.key);
      const text = document.createElement("span");
      text.className = "mdprv-table-pop-val";
      text.textContent = item.label;
      const count = document.createElement("span");
      count.className = "mdprv-table-pop-n";
      count.setAttribute("aria-hidden", "true");
      count.textContent = String(item.count);
      label.append(box, text, count);
      li.append(label);
      fragment.append(li);
    }
    popoverList.replaceChildren(fragment);
    popoverEmpty.hidden = shown !== 0;
  };

  const positionPopover = (): void => {
    if (!popover || popover.hidden || !popoverFunnel) {
      return;
    }
    const rect = popoverFunnel.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    let left = rect.left;
    if (left + width + margin > viewportWidth) {
      left = viewportWidth - width - margin;
    }
    if (left < margin) {
      left = margin;
    }
    let top = rect.bottom + 4;
    if (rect.bottom + height + margin + 4 > viewportHeight) {
      const above = rect.top - height - 4;
      top = above >= margin ? above : Math.max(margin, viewportHeight - height - margin);
    }
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  };

  const repositionPopover = (): void => {
    if (popover && !popover.hidden) {
      positionPopover();
    }
  };

  const onViewportChange = (): void => {
    if (rafPosition) {
      return;
    }
    rafPosition = window.requestAnimationFrame(() => {
      rafPosition = 0;
      positionPopover();
    });
  };

  const openPopover = (column: number, funnel: HTMLButtonElement): void => {
    if (!state.headerRow || (state.headerCol && column === 0) || state.raw) {
      return;
    }
    for (const close of POPOVER_CLOSERS) {
      close(false);
    }
    ensurePopover();
    const host = block.closest(".mdprv-table-lightbox") ?? document.body;
    if (popover && popover.parentNode !== host) {
      host.append(popover);
    }
    popoverCol = column;
    popoverFunnel = funnel;
    if (popoverTitle) {
      popoverTitle.textContent = columnLabel(column);
    }
    if (popoverSearch) {
      popoverSearch.value = "";
    }
    if (popover) {
      popover.setAttribute("aria-label", `Filtrar coluna ${columnLabel(column)}`);
      popover.hidden = false;
      popover.style.visibility = "hidden";
      renderPopoverList();
      positionPopover();
      popover.style.visibility = "";
    }
    popoverSearch?.setAttribute("aria-label", `Buscar valor em ${columnLabel(column)}`);
    popoverList?.setAttribute("aria-label", `Valores de ${columnLabel(column)}`);
    funnel.setAttribute("aria-expanded", "true");
    popoverSearch?.focus({ preventScroll: true });
    window.addEventListener("scroll", onViewportChange, { passive: true });
    window.addEventListener("resize", onViewportChange);
    updateFunnels();
  };

  function closePopover(refocus: boolean): void {
    if (!popover || popover.hidden) {
      return;
    }
    const funnel = popoverFunnel;
    popover.hidden = true;
    popoverCol = null;
    popoverFunnel = null;
    window.removeEventListener("scroll", onViewportChange);
    window.removeEventListener("resize", onViewportChange);
    if (funnel) {
      funnel.setAttribute("aria-expanded", "false");
      if (refocus) {
        funnel.focus({ preventScroll: true });
      }
    }
    updateFunnels();
  }

  /* ---------- chart view ---------- */
  let chartOptionSignature = "";

  /** Model of the rows currently visible on screen (filter + sort + pivot). */
  const chartModel = (): TableModel => ({
    header: state.headerRow ? headerCells().map((cell) => textOf(cell)) : [],
    rows: Array.from(tbody.rows)
      .filter((row) => !row.hidden)
      .map((row) => Array.from(row.cells).map((cell) => textOf(cell))),
    align: [],
  });

  function setChartView(next: boolean): void {
    if (chartActive === next) {
      if (next) {
        refreshChart();
      }
      return;
    }
    chartActive = next;
    block.setAttribute("data-mdprv-table-view", next ? "chart" : "table");
    if (chartContainer) {
      chartContainer.hidden = !next;
      if (!next) {
        chartContainer.replaceChildren();
      }
    }
    chartButton?.setAttribute("aria-pressed", next ? "true" : "false");
    if (next) {
      closePopover(false);
      if (searchIsOpen()) {
        closeSearch(false);
      }
      refreshChart();
    } else {
      requestSync();
    }
    updateToolbarState();
    syncLightboxGeometry();
  }

  function refreshChart(): void {
    if (!chartActive || !chartContainer) {
      return;
    }
    const model = chartModel();
    chartColumns = numericChartColumns(model);
    if (
      chartValueColumn === null ||
      !chartColumns.some((column) => column.index === chartValueColumn)
    ) {
      chartValueColumn =
        chartColumns.find((column) => column.index !== 0)?.index ??
        chartColumns[0]?.index ??
        null;
    }
    const data: ChartData | null =
      chartValueColumn === null
        ? null
        : buildChartData(model, { categoryColumn: 0, valueColumn: chartValueColumn });
    chartCurrentData = data;
    const reason = data ? chartUnavailableReason(chartKind, data) : "Sem coluna numérica.";
    if (!data || reason) {
      chartContainer.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "mdprv-chart-empty";
      empty.textContent = reason ?? "Sem dados para o gráfico.";
      chartContainer.append(empty);
    } else {
      renderChart(chartContainer, chartKind, data, chartPaletteTokens());
    }
    syncChartPopover(reason);
  }

  const ensureChartPopover = (): HTMLElement => {
    if (chartPopover) {
      return chartPopover;
    }
    const el = document.createElement("div");
    el.className = "mdprv-table-popover mdprv-chart-popover";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Visualização em gráfico");
    el.tabIndex = -1;
    el.hidden = true;
    const selectId = `${block.getAttribute("data-mdprv-table-id") ?? "mdprv-table"}-chart-series`;
    const options = (Object.keys(CHART_KIND_LABELS) as ChartKind[])
      .map(
        (kind) =>
          `<button type="button" class="mdprv-chart-option" data-chart-kind="${kind}" aria-pressed="false">` +
          `<span class="mdprv-chart-thumb">${CHART_PREVIEWS[kind]}</span>` +
          `<span class="mdprv-chart-option-label">${CHART_KIND_LABELS[kind]}</span>` +
          `</button>`
      )
      .join("");
    el.innerHTML =
      '<p class="mdprv-table-pop-title">Visualização em gráfico</p>' +
      `<div class="mdprv-chart-kinds" role="group" aria-label="Tipo de gráfico">${options}</div>` +
      `<label class="mdprv-chart-field" for="${selectId}">Série numérica</label>` +
      `<select id="${selectId}" class="mdprv-chart-select" data-chart-column aria-label="Coluna numérica do gráfico"></select>` +
      '<p class="mdprv-chart-note" data-chart-note hidden></p>' +
      '<div class="mdprv-table-pop-actions">' +
      '<button type="button" data-chart-back>Voltar para tabela</button>' +
      "</div>";
    document.body.append(el);
    chartPopover = el;

    el.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const option = target.closest<HTMLButtonElement>("[data-chart-kind]");
      if (option) {
        if (option.disabled) {
          return;
        }
        const kind = option.getAttribute("data-chart-kind") as ChartKind | null;
        if (kind && kind in CHART_KIND_LABELS) {
          chartKind = kind;
          setChartView(true);
          syncChartPopover();
          announce(`Gráfico: ${CHART_KIND_LABELS[kind]}.`);
        }
        return;
      }
      if (target.closest("[data-chart-back]")) {
        setChartView(false);
        syncChartPopover();
        announce("Tabela exibida novamente.");
      }
    });
    el.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement) || !target.matches("[data-chart-column]")) {
        return;
      }
      const index = Number.parseInt(target.value, 10);
      chartValueColumn = Number.isFinite(index) ? index : null;
      refreshChart();
    });
    el.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeChartPopover(true);
      }
    });
    return el;
  };

  const syncChartPopover = (reason?: string | null): void => {
    if (!chartPopover) {
      return;
    }
    for (const button of Array.from(
      chartPopover.querySelectorAll<HTMLButtonElement>("[data-chart-kind]")
    )) {
      const kind = button.getAttribute("data-chart-kind") as ChartKind | null;
      if (!kind) {
        continue;
      }
      button.setAttribute("aria-pressed", kind === chartKind ? "true" : "false");
      const unavailable = chartCurrentData
        ? chartUnavailableReason(kind, chartCurrentData)
        : "Sem coluna numérica.";
      button.disabled = unavailable !== null;
      button.title = unavailable ?? "";
    }
    const select = chartPopover.querySelector<HTMLSelectElement>("[data-chart-column]");
    if (select) {
      const signature = chartColumns.map((column) => column.index).join(",");
      if (signature !== chartOptionSignature) {
        chartOptionSignature = signature;
        select.replaceChildren(
          ...chartColumns.map((column) => {
            const option = document.createElement("option");
            option.value = String(column.index);
            option.textContent = column.label;
            return option;
          })
        );
      }
      select.value = chartValueColumn === null ? "" : String(chartValueColumn);
      select.disabled = chartColumns.length === 0;
    }
    const note = chartPopover.querySelector<HTMLElement>("[data-chart-note]");
    if (note) {
      note.hidden = !reason;
      note.textContent = reason ?? "";
    }
    const back = chartPopover.querySelector<HTMLButtonElement>("[data-chart-back]");
    if (back) {
      back.disabled = !chartActive;
    }
    chartButton?.setAttribute(
      "aria-expanded",
      chartPopover.hidden ? "false" : "true"
    );
  };

  const positionChartPopover = (): void => {
    if (!chartPopover || chartPopover.hidden || !chartAnchor) {
      return;
    }
    const rect = chartAnchor.getBoundingClientRect();
    const width = chartPopover.offsetWidth;
    const height = chartPopover.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const margin = 8;
    let left = rect.right - width;
    if (left + width + margin > viewportWidth) {
      left = viewportWidth - width - margin;
    }
    if (left < margin) {
      left = margin;
    }
    let top = rect.bottom + 4;
    if (rect.bottom + height + margin + 4 > viewportHeight) {
      const above = rect.top - height - 4;
      top = above >= margin ? above : Math.max(margin, viewportHeight - height - margin);
    }
    chartPopover.style.left = `${Math.round(left)}px`;
    chartPopover.style.top = `${Math.round(top)}px`;
  };

  const onChartViewportChange = (): void => {
    positionChartPopover();
  };

  const openChartPopover = (anchor: HTMLButtonElement): void => {
    for (const close of POPOVER_CLOSERS) {
      close(false);
    }
    if (searchIsOpen()) {
      closeSearch(false);
    }
    const el = ensureChartPopover();
    const host = block.closest(".mdprv-table-lightbox") ?? document.body;
    if (el.parentNode !== host) {
      host.append(el);
    }
    chartAnchor = anchor;
    if (!chartActive) {
      // Keep the option availability in sync with the current view even before
      // a chart is chosen.
      const model = chartModel();
      chartColumns = numericChartColumns(model);
      if (
        chartValueColumn === null ||
        !chartColumns.some((column) => column.index === chartValueColumn)
      ) {
        chartValueColumn =
          chartColumns.find((column) => column.index !== 0)?.index ??
          chartColumns[0]?.index ??
          null;
      }
      chartCurrentData =
        chartValueColumn === null
          ? null
          : buildChartData(model, { categoryColumn: 0, valueColumn: chartValueColumn });
    }
    el.hidden = false;
    el.style.visibility = "hidden";
    syncChartPopover(
      chartCurrentData
        ? chartUnavailableReason(chartKind, chartCurrentData)
        : "Sem coluna numérica."
    );
    positionChartPopover();
    el.style.visibility = "";
    window.addEventListener("scroll", onChartViewportChange, { passive: true });
    window.addEventListener("resize", onChartViewportChange);
    const focusTarget =
      el.querySelector<HTMLButtonElement>("[data-chart-kind]:not([disabled])") ??
      el.querySelector<HTMLButtonElement>("[data-chart-back]");
    focusTarget?.focus({ preventScroll: true });
  };

  function closeChartPopover(refocus: boolean): void {
    if (!chartPopover || chartPopover.hidden) {
      return;
    }
    const anchor = chartAnchor;
    chartPopover.hidden = true;
    chartAnchor = null;
    window.removeEventListener("scroll", onChartViewportChange);
    window.removeEventListener("resize", onChartViewportChange);
    chartButton?.setAttribute("aria-expanded", "false");
    if (refocus) {
      anchor?.focus({ preventScroll: true });
    }
  }

  const chartPopoverOpen = (): boolean => chartPopover !== null && !chartPopover.hidden;

  /* ---------- filtering + search ---------- */
  const applyFilter = (): void => {
    const visible = filterRows(view.rows, {
      query: state.filter,
      columnFilters: state.colFilters,
      excludeColumn: state.headerCol ? 0 : null,
      normalized: view.normalized,
    });
    const rows = dataRows();
    let count = 0;
    rows.forEach((row) => {
      const show = visible[Number(row.dataset.mdprvOrigIndex)] ?? false;
      row.hidden = !show;
      if (show) {
        count += 1;
      }
    });
    const active = state.filter !== "" || state.colFilters.size > 0;
    countEl.textContent = active ? `${count} de ${rows.length} linhas` : "";
    emptyEl.hidden = count !== 0;
    buildRowHead();
    requestSync();
    updateFunnels();
    paint();
    if (chartActive) {
      refreshChart();
    }
  };

  const runFilter = debounce(() => applyFilter(), 100);

  const searchIsOpen = (): boolean => searchWrap.getAttribute("data-open") === "true";

  const openSearch = (): void => {
    if (state.raw) {
      return;
    }
    searchWrap.setAttribute("data-open", "true");
    filterInput.tabIndex = 0;
    filterButton?.setAttribute("aria-expanded", "true");
    filterButton?.setAttribute("aria-label", "Fechar pesquisa");
    if (filterButton) {
      filterButton.title = "Fechar pesquisa";
    }
    window.requestAnimationFrame(() => {
      filterInput.focus({ preventScroll: true });
      filterInput.select();
    });
  };

  const closeSearch = (clearFilter: boolean): void => {
    const wasOpen = searchIsOpen();
    searchWrap.setAttribute("data-open", "false");
    filterInput.tabIndex = -1;
    filterButton?.setAttribute("aria-expanded", "false");
    filterButton?.setAttribute("aria-label", "Pesquisar linhas");
    if (filterButton) {
      filterButton.title = "Pesquisar linhas";
    }
    if (clearFilter) {
      state.filter = "";
      filterInput.value = "";
      applyFilter();
    }
    if (wasOpen && filterButton && document.activeElement === filterInput) {
      filterButton.focus({ preventScroll: true });
    }
  };

  filterInput.addEventListener("input", () => {
    state.filter = filterInput.value;
    runFilter();
  });
  filterInput.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeSearch(true);
  });

  /* ---------- toolbar state ---------- */
  function updateToolbarState(): void {
    const mode = rawMode();
    const range = activeRange();
    if (headerRowButton) {
      headerRowButton.disabled = state.pivot || mode.raw;
      headerRowButton.title = state.pivot
        ? "Indisponível no modo pivotado"
        : "Usar 1ª linha como cabeçalho";
    }
    if (headerColButton) {
      headerColButton.disabled = state.pivot || mode.raw;
      headerColButton.title = state.pivot
        ? "Indisponível no modo pivotado"
        : "Usar 1ª coluna como cabeçalho";
    }
    if (pivotButton) {
      pivotButton.disabled = mode.raw;
    }
    if (filterButton) {
      filterButton.disabled = mode.raw;
    }
    if (rawButton) {
      rawButton.disabled = mode.locked;
      rawButton.setAttribute("aria-pressed", mode.raw ? "true" : "false");
      rawButton.title = mode.locked
        ? "O modo raw do documento está ativo"
        : "";
    }
    if (filterInput) {
      filterInput.disabled = mode.raw;
    }
    if (copyButton) {
      const label = mode.raw
        ? "Copiar CSV como texto"
        : range
          ? "Copiar intervalo como TSV"
          : "Copiar tabela como Markdown";
      copyButton.setAttribute("aria-label", label);
      copyButton.title = label;
    }
    if (csvButton) {
      const label = mode.raw ? "Copiar CSV como texto" : "Copiar tabela como CSV";
      csvButton.setAttribute("aria-label", label);
      csvButton.title = label;
    }
    if (chartButton) {
      chartButton.disabled = mode.raw;
      chartButton.setAttribute("aria-pressed", chartActive ? "true" : "false");
      chartButton.setAttribute(
        "aria-expanded",
        chartPopover && !chartPopover.hidden ? "true" : "false"
      );
      const label = mode.raw ? "Gráfico indisponível no modo raw" : "Visualizar como gráfico";
      chartButton.setAttribute("aria-label", label);
      chartButton.title = label;
    }
  }

  const activeRange = (): TableRange | null => {
    if (state.ranges.length === 0) {
      return null;
    }
    return normalizeRange(state.ranges[0]!);
  };

  const allRowsText = (): string[][] => {
    const rows: string[][] = [];
    const columns = colCount();
    for (let r = 0; r <= rowCount(); r += 1) {
      const values: string[] = [];
      for (let c = 0; c < columns; c += 1) {
        const cell = cellAt(r, c);
        values.push(cell ? textOf(cell) : "");
      }
      rows.push(values);
    }
    return rows;
  };

  /**
   * Every row currently rendered (header included), in display order. Unlike
   * `textOf`, embedded line breaks are preserved so CSV export can quote them
   * instead of silently collapsing real multi-line cell data.
   */
  const exportText = (cell: Element): string =>
    (cell.textContent ?? "").replace(/\r\n?/g, "\n").trim();

  const displayedRows = (): string[][] =>
    Array.from(table.rows)
      .filter((row) => !row.hidden)
      .map((row) => Array.from(row.cells).map((cell) => exportText(cell)));

  const copyCsv = (): void => {
    if (!csvButton) {
      return;
    }
    const mode = rawMode();
    const payload =
      mode.raw && rawView ? rawView.textContent ?? "" : serializeCsv(displayedRows());
    copyText(payload).then(
      () => {
        flashCopied(csvButton, "mdprv-copied", CSV_ICON);
        announce("Tabela copiada como CSV.");
      },
      () => flashCopyError(csvButton, "Não foi possível copiar")
    );
  };

  const copy = (): void => {
    if (!copyButton) {
      return;
    }
    const mode = rawMode();
    if (mode.raw && rawView) {
      copyText(rawView.textContent ?? "").then(
        () => {
          flashCopied(copyButton);
          announce("CSV copiado como texto.");
        },
        () => flashCopyError(copyButton, "Não foi possível copiar")
      );
      return;
    }
    const range = activeRange();
    const payload = range
      ? serializeTsv(allRowsText(), range)
      : serializeMarkdownTable({
          header: view.labels,
          rows: dataRows()
            .filter((row) => !row.hidden)
            .map((row) => Array.from(row.cells).map((cell) => textOf(cell))),
          align: view.align,
        });
    copyText(payload).then(
      () => {
        flashCopied(copyButton);
        announce(range ? "Intervalo copiado como TSV." : "Tabela copiada como Markdown.");
      },
      () => flashCopyError(copyButton, "Não foi possível copiar")
    );
  };

  /* ---------- header/column actions ---------- */
  const setHeaderRow = (next: boolean): void => {
    state.headerRow = next;
    if (!next) {
      state.colFilters.clear();
      closePopover(false);
      clearSort();
    }
    headerRowButton?.setAttribute("aria-pressed", next ? "true" : "false");
    renderStructure(true);
    applyFilter();
    paint();
    syncFunnels();
    announce(
      next
        ? "Primeira linha como cabeçalho: ordenação e pesquisa ativas."
        : "Cabeçalho da primeira linha desativado."
    );
  };

  const setHeaderCol = (next: boolean): void => {
    state.headerCol = next;
    if (next) {
      state.colFilters.delete(0);
      if (popoverCol === 0) {
        closePopover(false);
      }
    }
    headerColButton?.setAttribute("aria-pressed", next ? "true" : "false");
    renderStructure(true);
    if (state.sortColumn !== null && state.sortDirection !== null) {
      applySortOrder(state.sortColumn, state.sortDirection);
    }
    applyFilter();
    paint();
    syncFunnels();
    announce(
      next
        ? "Primeira coluna como cabeçalho (rótulo fixo)."
        : "Cabeçalho da primeira coluna desativado."
    );
  };

  const buildPivotView = (): ViewModel => {
    const model: TableModel = {
      header: baseView.labels,
      rows: baseView.rows,
      align: baseView.align,
    };
    const pivoted = pivotTable(model);
    return {
      labels: pivoted.header,
      headerHtml: null,
      rows: pivoted.rows,
      rowsHtml: null,
      align: pivoted.align,
      normalized: pivoted.rows.map((row) => row.map((cell) => normalizeCellText(cell))),
      numeric: pivoted.header.map((_, column) =>
        isNumericColumn(pivoted.rows.map((row) => row[column] ?? ""))
      ),
    };
  };

  const setPivot = (next: boolean): void => {
    if (state.pivot === next) {
      return;
    }
    closePopover(false);
    if (next) {
      pivotSaved = {
        headerRow: state.headerRow,
        headerCol: state.headerCol,
        sortColumn: state.sortColumn,
        sortDirection: state.sortDirection,
      };
      state.pivot = true;
      state.headerRow = true;
      state.headerCol = false;
      view = buildPivotView();
      pivotWidths = null;
      state.colFilters.clear();
      state.sortColumn = null;
      state.sortDirection = null;
      if (pivotButton) {
        pivotButton.setAttribute("aria-pressed", "true");
      }
      announce("Tabela pivotada: linhas e colunas trocadas.");
    } else {
      const saved = pivotSaved;
      state.pivot = false;
      state.headerRow = saved?.headerRow ?? true;
      state.headerCol = saved?.headerCol ?? false;
      view = baseView;
      state.colFilters.clear();
      state.sortColumn = null;
      state.sortDirection = null;
      if (pivotButton) {
        pivotButton.setAttribute("aria-pressed", "false");
      }
      announce("Tabela de volta ao arranjo original.");
    }
    headerRowButton?.setAttribute("aria-pressed", state.headerRow ? "true" : "false");
    headerColButton?.setAttribute("aria-pressed", state.headerCol ? "true" : "false");
    renderStructure(true);
    if (!next && pivotSaved?.sortColumn !== null && pivotSaved?.sortColumn !== undefined) {
      applySortOrder(pivotSaved.sortColumn, pivotSaved.sortDirection);
    }
    applyFilter();
    paint();
    syncFunnels();
    updateToolbarState();
    syncLightboxGeometry();
    if (!next) {
      pivotSaved = null;
    }
  };

  /* ---------- raw mode ---------- */
  const syncRaw = (): void => {
    const mode = rawMode();
    block.setAttribute("data-mdprv-table-raw", mode.raw ? "1" : "0");
    if (rawView) {
      rawView.hidden = !mode.raw;
    }
    if (mode.raw) {
      closePopover(false);
      closeChartPopover(false);
      if (chartActive) {
        setChartView(false);
      }
      if (searchIsOpen()) {
        closeSearch(false);
      }
    }
    syncFunnels();
    updateToolbarState();
    if (!mode.raw) {
      requestSync();
    }
  };

  /* ---------- gesture/selection events ---------- */
  table.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>(
      "[role='gridcell'], [role='rowheader'], [role='columnheader']"
    );
    if (!cell) {
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) {
      return;
    }
    const r = rowIndexOf(row);
    const c = cell.cellIndex;
    if (r === 0) {
      return;
    }
    event.preventDefault();
    if (event.shiftKey && state.anchor) {
      setActive(r, c, true);
    } else if (event.ctrlKey || event.metaKey) {
      addRange(r, c);
    } else {
      setActive(r, c, false);
      state.dragging = true;
    }
    cellAt(r, c)?.focus({ preventScroll: true });
  });

  table.addEventListener("mousemove", (event) => {
    if (!state.dragging || !state.anchor) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>("[role='gridcell']");
    if (!cell) {
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) {
      return;
    }
    const r = rowIndexOf(row);
    const c = cell.cellIndex;
    state.ranges = [rangeFrom(state.anchor, { r, c })];
    state.active = { r, c };
    paint();
  });

  document.addEventListener("mouseup", () => {
    state.dragging = false;
  });

  /* Activate the focused cell when the grid is entered without a prior
     selection (Tab or programmatic focus), so the roving tab stop and the
     arrow-key handler always have an anchor. */
  table.addEventListener("focusin", (event) => {
    if (state.active) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>(
      "[role='gridcell'], [role='rowheader'], [role='columnheader']"
    );
    const row = cell?.parentElement as HTMLTableRowElement | null;
    if (!cell || !row || event.target !== cell) {
      return;
    }
    if (!cellAt(rowIndexOf(row), cell.cellIndex)) {
      return;
    }
    state.active = { r: rowIndexOf(row), c: cell.cellIndex };
    state.anchor = state.active;
    paint();
  });

  /* ---------- keyboard ---------- */
  const lightboxOpen = (): boolean =>
    block.closest(".mdprv-table-lightbox") !== null;

  table.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>(
      "[role='gridcell'], [role='rowheader'], [role='columnheader']"
    );
    if (!cell) {
      return;
    }
    const row = cell.parentElement as HTMLTableRowElement | null;
    if (!row) {
      return;
    }
    const r = rowIndexOf(row);
    const c = cell.cellIndex;
    const maxR = rowCount();
    const maxC = colCount();
    const minR = thead.rows[0]?.cells.length ? 0 : 1;
    const isColumnHeader = cell.getAttribute("role") === "columnheader";
    let next: CellPosition | null = null;

    switch (event.key) {
      case "ArrowUp":
        next = { r: Math.max(minR, r - 1), c };
        break;
      case "ArrowDown":
        next = { r: Math.min(maxR, r + 1), c };
        break;
      case "ArrowLeft":
        next = { r, c: Math.max(0, c - 1) };
        break;
      case "ArrowRight":
        next = { r, c: Math.min(maxC - 1, c + 1) };
        break;
      case "Home":
        next = { r, c: 0 };
        break;
      case "End":
        next = { r, c: maxC - 1 };
        break;
      case "PageUp":
        next = { r: Math.max(minR, r - 5), c };
        break;
      case "PageDown":
        next = { r: Math.min(maxR, r + 5), c };
        break;
      case "Tab": {
        if (lightboxOpen() || isColumnHeader) {
          return;
        }
        event.preventDefault();
        next = { r, c: (c + 1) % maxC };
        if (c + 1 >= maxC && r + 1 <= maxR) {
          next = { r: r + 1, c: 0 };
        }
        break;
      }
      case "Enter":
        if (isColumnHeader) {
          // Header cells sort with Enter/Space; keep the active cell put.
          return;
        }
        event.preventDefault();
        next = { r: Math.min(maxR, r + 1), c };
        break;
      case "Escape":
        event.preventDefault();
        if (searchIsOpen()) {
          event.stopPropagation();
          closeSearch(true);
          announce("Pesquisa fechada.");
          return;
        }
        clearSelection();
        announce("Seleção limpa.");
        return;
      default:
        return;
    }
    event.preventDefault();
    if (!next) {
      return;
    }
    setActive(next.r, next.c, event.shiftKey);
    cellAt(next.r, next.c)?.focus();
  });

  table.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[role='gridcell']")) {
      return;
    }
    const range = activeRange();
    if (range && (range.r1 !== range.r2 || range.c1 !== range.c2)) {
      event.preventDefault();
      copyText(serializeTsv(allRowsText(), range)).then(
        () => announce("Intervalo copiado como TSV."),
        () => announce("Não foi possível copiar.")
      );
    }
  });

  /* ---------- gutter interactions ---------- */
  colhead.addEventListener("click", (event) => {
    if (suppressColheadClick) {
      suppressColheadClick = false;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || target.closest(".mdprv-sheet-resize")) {
      return;
    }
    const tag = target.closest<HTMLElement>("[data-mdprv-col]");
    if (!tag) {
      return;
    }
    const column = Number(tag.getAttribute("data-mdprv-col"));
    state.ranges = [{ r1: 0, c1: column, r2: rowCount(), c2: column }];
    state.anchor = { r: 0, c: column };
    state.active = { r: 0, c: column };
    paint();
    announce(`Coluna ${columnLetter(column)} selecionada.`);
  });

  rowhead.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const tag = target.closest<HTMLElement>("[data-mdprv-row]");
    if (!tag) {
      return;
    }
    const r = Number(tag.getAttribute("data-mdprv-row"));
    const last = colCount() - 1;
    state.ranges = [{ r1: r, c1: 0, r2: r, c2: last }];
    state.anchor = { r, c: 0 };
    state.active = { r, c: 0 };
    paint();
    announce(`Linha ${r + 1} selecionada.`);
  });

  const gutterKeyboard = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const tag = target.closest<HTMLElement>("[data-mdprv-col], [data-mdprv-row]");
    if (!tag) {
      return;
    }
    event.preventDefault();
    tag.click();
  };
  colhead.addEventListener("keydown", gutterKeyboard);
  rowhead.addEventListener("keydown", gutterKeyboard);

  /* ---------- resize ---------- */
  colhead.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const handle = target.closest<HTMLElement>(".mdprv-sheet-resize");
    if (!handle) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const index = Number(handle.getAttribute("data-mdprv-col"));
    const startX = event.clientX;
    const columns = colElements();
    const z = zoomFactor(block);
    const current = columns[index];
    if (!current) {
      return;
    }
    const startWidth = current.getBoundingClientRect().width / z;
    const neighbour = columns[index + 1];
    const nextWidth = neighbour ? neighbour.getBoundingClientRect().width / z : 0;
    let moved = false;

    const onMove = (moveEvent: PointerEvent): void => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 2) {
        return;
      }
      moved = true;
      const delta = (moveEvent.clientX - startX) / z;
      let width = Math.max(TABLE_MIN_COLUMN_WIDTH, startWidth + delta);
      if (nextWidth > 0) {
        let other = nextWidth - (width - startWidth);
        if (other < TABLE_MIN_COLUMN_WIDTH) {
          width = startWidth + (nextWidth - TABLE_MIN_COLUMN_WIDTH);
          other = TABLE_MIN_COLUMN_WIDTH;
        }
        setColumnWidth(index + 1, other);
      }
      setColumnWidth(index, width);
      handle.setAttribute("aria-valuenow", String(Math.round(width)));
      requestSync();
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        suppressColheadClick = true;
        window.setTimeout(() => {
          suppressColheadClick = false;
        }, 0);
        announce("Coluna redimensionada.");
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  colhead.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const handle = target.closest<HTMLElement>(".mdprv-sheet-resize");
    if (!handle) {
      return;
    }
    event.preventDefault();
    autoFitColumn(Number(handle.getAttribute("data-mdprv-col")));
    requestSync();
    announce("Coluna ajustada ao conteúdo.");
  });

  colhead.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const handle = target.closest<HTMLElement>(".mdprv-sheet-resize");
    if (!handle) {
      return;
    }
    const index = Number(handle.getAttribute("data-mdprv-col"));
    const columns = colElements();
    const current = columns[index];
    if (!current) {
      return;
    }
    const z = zoomFactor(block);
    const width = current.getBoundingClientRect().width / z;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setColumnWidth(index, width - 16);
      requestSync();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setColumnWidth(index, width + 16);
      requestSync();
    } else if (event.key === "Home") {
      event.preventDefault();
      autoFitColumn(index);
      requestSync();
    }
  });

  /* ---------- header sorting / funnels ---------- */
  thead.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const funnel = target.closest<HTMLButtonElement>("[data-mdprv-funnel]");
    if (funnel) {
      event.preventDefault();
      const column = Number(funnel.getAttribute("data-mdprv-funnel"));
      if (popoverCol === column && popover && !popover.hidden) {
        closePopover(true);
      } else {
        openPopover(column, funnel);
      }
      return;
    }
    if (target.closest("a,button")) {
      return;
    }
    if (!state.headerRow || state.pivot) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>("th");
    if (cell) {
      cycleSort(cell.cellIndex);
    }
  });

  thead.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest("button, a, input")) {
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (!state.headerRow || state.pivot) {
      return;
    }
    const cell = target.closest<HTMLTableCellElement>("th");
    if (!cell) {
      return;
    }
    event.preventDefault();
    cycleSort(cell.cellIndex);
  });

  /* ---------- toolbar actions ---------- */
  toolbar.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("[data-mdprv-table-action]");
    if (!button || !toolbar.contains(button)) {
      return;
    }
    switch (button.getAttribute("data-mdprv-table-action")) {
      case "header-row":
        if (!state.pivot && !rawMode().raw) {
          setHeaderRow(!state.headerRow);
        }
        break;
      case "header-col":
        if (!state.pivot && !rawMode().raw) {
          setHeaderCol(!state.headerCol);
        }
        break;
      case "pivot":
        if (!rawMode().raw) {
          setPivot(!state.pivot);
        }
        break;
      case "filter":
        if (searchIsOpen()) {
          closeSearch(true);
        } else {
          openSearch();
        }
        break;
      case "raw":
        if (!rawMode().locked) {
          state.raw = !state.raw;
          syncRaw();
          announce(state.raw ? "Código CSV original exibido." : "Tabela CSV exibida.");
        }
        break;
      case "copy":
        copy();
        break;
      case "copy-csv":
        copyCsv();
        break;
      case "chart":
        if (rawMode().raw) {
          break;
        }
        if (chartPopoverOpen()) {
          closeChartPopover(true);
        } else {
          openChartPopover(button);
        }
        break;
      case "fullscreen":
        if (block.closest(".mdprv-table-lightbox")) {
          closeLightbox();
        } else {
          openLightbox(block);
        }
        break;
      default:
        break;
    }
  });

  /* ---------- outside clicks ---------- */
  /**
   * The component owns the table block, its portal-ed popover and, when the
   * table is expanded, the fullscreen dialog. Anything else is "outside" and
   * drops the selection, so the default (nothing selected) is restored.
   */
  const ownsTarget = (target: Element): boolean => {
    if (block.contains(target)) {
      return true;
    }
    if (popover && !popover.hidden && popover.contains(target)) {
      return true;
    }
    if (chartPopover && !chartPopover.hidden && chartPopover.contains(target)) {
      return true;
    }
    const dialog = block.closest(".mdprv-table-lightbox");
    return dialog !== null && dialog.contains(target);
  };

  const clearOnOutsidePress = (event: Event): void => {
    if (state.ranges.length === 0 && !state.active && !state.anchor) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element) || ownsTarget(target)) {
      return;
    }
    clearSelection();
  };

  if ("onpointerdown" in document.documentElement) {
    document.addEventListener("pointerdown", clearOnOutsidePress, true);
  } else {
    document.addEventListener("mousedown", clearOnOutsidePress, true);
  }

  // The toolbar strip is the table's title band: a plain click on its
  // background drops the cell selection, while its controls keep their jobs.
  toolbar?.addEventListener("click", (event) => {
    if (lightboxSuppressClick) {
      // A pan that started on the strip ends with a synthetic click.
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest(
        "button, a, input, select, textarea, [role='separator'], .mdprv-table-search"
      )
    ) {
      return;
    }
    clearSelection();
  });

  document.addEventListener("mousedown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (popover && !popover.hidden) {
      if (popover.contains(target) || target.closest(".mdprv-table-funnel")) {
        return;
      }
      if (target.closest(".mdprv-table-lb-tools")) {
        return;
      }
      const funnel = popoverFunnel;
      const focusable = target.closest(
        "a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])"
      );
      closePopover(false);
      if (!focusable && funnel) {
        window.setTimeout(() => funnel.focus({ preventScroll: true }), 0);
      }
    }
    if (chartPopover && !chartPopover.hidden) {
      if (
        !chartPopover.contains(target) &&
        !target.closest('[data-mdprv-table-action="chart"]')
      ) {
        closeChartPopover(false);
      }
    }
    if (!searchIsOpen()) {
      return;
    }
    if (toolbar.contains(target)) {
      return;
    }
    if (target.closest(".mdprv-table-funnel")) {
      return;
    }
    if (target.closest(".mdprv-table-lb-tools")) {
      return;
    }
    const lightbox = block.closest(".mdprv-table-lightbox");
    if (lightbox && !block.contains(target)) {
      return;
    }
    if (popover && popover.contains(target)) {
      return;
    }
    closeSearch(true);
  });

  if (sheetBody) {
    sheetBody.addEventListener("scroll", () => syncGutterScroll(), { passive: true });
  }
  window.addEventListener(
    "resize",
    debounce(() => {
      rowHeights = new WeakMap();
      requestSync();
    }, 120)
  );

  /* ---------- boot ---------- */
  normalizeHeader();
  decorateExistingRows();
  table.setAttribute("aria-rowcount", String(view.rows.length + 1));
  table.setAttribute("aria-colcount", String(view.labels.length));
  headerRowButton?.setAttribute("aria-pressed", state.headerRow ? "true" : "false");
  headerColButton?.setAttribute("aria-pressed", state.headerCol ? "true" : "false");
  pivotButton?.setAttribute("aria-pressed", "false");
  ensureColgroup();
  buildSheetChrome();
  paint();
  applyFilter();
  syncFunnels();
  syncRaw();
  toolbar.hidden = false;
  block.dataset.mdprvTableReady = "1";
  window.requestAnimationFrame(() => {
    syncGutterSizes();
  });

  POPOVER_CLOSERS.add(closePopover);

  const controller: TableController = {
    block,
    sync: () => {
      rowHeights = new WeakMap();
      syncGutterSizes();
    },
    naturalWidth: () => naturalWidth(),
    reposition: repositionPopover,
    closePopover,
    popoverOpen: () => popover !== null && !popover.hidden,
    chartPopoverOpen,
    closeChartPopover,
    setGlobalRaw: (raw: boolean) => {
      if (state.globalRaw === raw) {
        return;
      }
      state.globalRaw = raw;
      syncRaw();
    },
  };
  CONTROLLERS.set(block, controller);
  return controller;
}

/* ---------- fullscreen dialog ---------- */
let lightbox: HTMLElement | null = null;
let stage: HTMLElement | null = null;
let frame: HTMLElement | null = null;
let lightboxBlock: HTMLElement | null = null;
let lightboxMarker: Comment | null = null;
let lightboxFocus: HTMLElement | null = null;
let lightboxZoom = 1;
/** Pan offset in screen pixels, applied as a transform on the frame. */
let lightboxPanX = 0;
let lightboxPanY = 0;
/** Explicit viewport size in the block's zoom-relative (layout) pixels. */
let lightboxWidth: number | null = null;
let lightboxHeight: number | null = null;
/** Natural width of the block when the dialog opened (before user resizing). */
let lightboxBaseWidth = 0;
let lightboxSpace = false;
let lightboxSuppressClick = false;
let lightboxSizeFrame = 0;
let lightboxPan: {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  startLeft: number;
  startTop: number;
  moved: boolean;
} | null = null;
let lightboxResize: {
  pointerId: number;
  handle: string;
  startX: number;
  startY: number;
  width: number;
  height: number;
  zoom: number;
  horizontal: number;
  vertical: number;
  moved: boolean;
} | null = null;
/** True when the frame size changed since the last successful persistence. */
let lightboxSizeDirty = false;
let lightboxSaveTimer = 0;

interface StoredLightboxSize {
  width: number | null;
  height: number | null;
}

function validStoredPx(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= LIGHTBOX_STORAGE_MAX_PX
  );
}

/** Returns null when storage is blocked (privacy mode, quota, no window). */
function lightboxStorage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function lightboxDocumentPath(): string {
  try {
    return window.location.pathname || "/";
  } catch {
    return "/";
  }
}

function lightboxSizeKey(tableId: string): string {
  return `${LIGHTBOX_STORAGE_PREFIX}${lightboxDocumentPath()}:${tableId}`;
}

/** Reads and validates one table's saved frame size; never throws. */
function readSavedLightboxSize(tableId: string): StoredLightboxSize | null {
  if (!tableId) {
    return null;
  }
  const storage = lightboxStorage();
  if (!storage) {
    return null;
  }
  const key = lightboxSizeKey(tableId);
  let raw: string | null = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null || raw === "") {
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    // Corrupted payload: drop it so the table opens at the default size.
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  const record = value as { w?: unknown; h?: unknown };
  const width = validStoredPx(record.w) ? record.w : null;
  const height = validStoredPx(record.h) ? record.h : null;
  if (width === null && height === null) {
    // Shape is wrong or every dimension is invalid: discard the entry.
    try {
      storage.removeItem(key);
    } catch {
      /* ignore */
    }
    return null;
  }
  return { width, height };
}

/** Writes the frame size for one table; storage failures degrade silently. */
function writeSavedLightboxSize(
  tableId: string,
  width: number | null,
  height: number | null
): void {
  if (!tableId) {
    return;
  }
  const storage = lightboxStorage();
  if (!storage) {
    return;
  }
  const payload: { w?: number; h?: number } = {};
  if (width !== null && validStoredPx(width)) {
    payload.w = Math.round(width * 100) / 100;
  }
  if (height !== null && validStoredPx(height)) {
    payload.h = Math.round(height * 100) / 100;
  }
  try {
    if (payload.w === undefined && payload.h === undefined) {
      storage.removeItem(lightboxSizeKey(tableId));
      return;
    }
    storage.setItem(lightboxSizeKey(tableId), JSON.stringify(payload));
  } catch {
    /* storage full or blocked: keep working with the in-memory size */
  }
}

function clearSavedLightboxSize(tableId: string): void {
  if (!tableId) {
    return;
  }
  const storage = lightboxStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(lightboxSizeKey(tableId));
  } catch {
    /* ignore */
  }
}

function currentLightboxTableId(): string {
  return lightboxBlock?.getAttribute("data-mdprv-table-id") ?? "";
}

/**
 * Clamp a restored value with the same bounds as a resize gesture: the floor is
 * the current size when that size is already below the 40% stage minimum (small
 * tables), and the ceiling is always the 200% stage maximum.
 */
function clampStoredSize(
  value: number,
  limits: { min: number; max: number }
): number {
  return clampValue(value, Math.min(limits.min, value), limits.max);
}

/** Persists the current frame size. Called on gesture end and on dialog close. */
function persistLightboxSize(): void {
  if (lightboxSaveTimer) {
    window.clearTimeout(lightboxSaveTimer);
    lightboxSaveTimer = 0;
  }
  if (!lightboxSizeDirty || !lightboxBlock) {
    return;
  }
  const tableId = currentLightboxTableId();
  lightboxSizeDirty = false;
  if (!tableId) {
    return;
  }
  writeSavedLightboxSize(tableId, lightboxWidth, lightboxHeight);
}

/** Keyboard nudges arrive in bursts; coalesce them into one write. */
function scheduleLightboxSizeSave(): void {
  if (!lightboxBlock) {
    return;
  }
  lightboxSizeDirty = true;
  if (lightboxSaveTimer) {
    window.clearTimeout(lightboxSaveTimer);
  }
  lightboxSaveTimer = window.setTimeout(() => {
    lightboxSaveTimer = 0;
    persistLightboxSize();
  }, 180);
}

function forgetLightboxSize(): void {
  lightboxSizeDirty = false;
  if (lightboxSaveTimer) {
    window.clearTimeout(lightboxSaveTimer);
    lightboxSaveTimer = 0;
  }
  clearSavedLightboxSize(currentLightboxTableId());
}

function activeController(): TableController | null {
  return lightboxBlock ? CONTROLLERS.get(lightboxBlock) ?? null : null;
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Center of the stage's content box, in viewport coordinates. */
function stageCenter(): { x: number; y: number } {
  if (!stage) {
    return { x: 0, y: 0 };
  }
  const rect = stage.getBoundingClientRect();
  // Scrollbars are hidden, so there are no asymmetric gutters: the border-box
  // center is also the layout center of the flex content.
  return {
    x: rect.left + rect.width / 2 - stage.scrollLeft,
    y: rect.top + rect.height / 2 - stage.scrollTop,
  };
}

/** Keeps a meaningful slice of the table inside the stage. */
function clampLightboxPan(): void {
  if (!frame || !stage) {
    return;
  }
  const rect = frame.getBoundingClientRect();
  const centre = stageCenter();
  const stageRect = stage.getBoundingClientRect();
  const minVisible = Math.min(
    120,
    Math.max(48, Math.min(rect.width, rect.height) * 0.3)
  );
  const minX = stageRect.left + minVisible - centre.x - rect.width / 2;
  const maxX = stageRect.right - minVisible - centre.x + rect.width / 2;
  const minY = stageRect.top + minVisible - centre.y - rect.height / 2;
  const maxY = stageRect.bottom - minVisible - centre.y + rect.height / 2;
  lightboxPanX =
    minX > maxX ? (minX + maxX) / 2 : clampValue(lightboxPanX, minX, maxX);
  lightboxPanY =
    minY > maxY ? (minY + maxY) / 2 : clampValue(lightboxPanY, minY, maxY);
}

function applyLightboxPan(): void {
  if (!frame) {
    return;
  }
  frame.style.transform = `translate(${lightboxPanX.toFixed(2)}px, ${lightboxPanY.toFixed(2)}px)`;
}

/** Visual limits for resize handles. They are divided by the zoom below. */
function resizeLimits(zoom: number): {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  width: { min: number; max: number };
  height: { min: number; max: number };
} {
  const stageWidth = stage?.clientWidth ?? 960;
  const stageHeight = stage?.clientHeight ?? 720;
  const minWidth = Math.max(280, stageWidth * 0.4);
  const maxWidth = Math.max(minWidth + 40, stageWidth * 2);
  const minHeight = Math.max(160, stageHeight * 0.4);
  const maxHeight = Math.max(minHeight + 40, stageHeight * 2);
  return {
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    width: { min: minWidth / zoom, max: maxWidth / zoom },
    height: { min: minHeight / zoom, max: maxHeight / zoom },
  };
}

/**
 * Axis direction of each resize handle. Corners combine both axes, so the same
 * gesture logic used by the edges also works on the four corners.
 */
const LIGHTBOX_HANDLE_DIRECTIONS: Record<string, { x: number; y: number }> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  nw: { x: -1, y: -1 },
  ne: { x: 1, y: -1 },
  sw: { x: -1, y: 1 },
  se: { x: 1, y: 1 },
};

function handleDirection(kind: string): { x: number; y: number } {
  return LIGHTBOX_HANDLE_DIRECTIONS[kind] ?? { x: 0, y: 0 };
}

function syncHandleAria(): void {
  if (!frame || !lightboxBlock) {
    return;
  }
  const zoom = zoomFactor(lightboxBlock);
  const rect = lightboxBlock.getBoundingClientRect();
  const limits = resizeLimits(zoom);
  frame.querySelectorAll<HTMLElement>("[data-lb-handle]").forEach((handle) => {
    const kind = handle.getAttribute("data-lb-handle") ?? "";
    const direction = handleDirection(kind);
    const horizontal = direction.x !== 0;
    const now = horizontal ? rect.width : rect.height;
    handle.setAttribute("aria-valuenow", String(Math.round(now)));
    handle.setAttribute(
      "aria-valuemin",
      String(Math.round(horizontal ? limits.minWidth : limits.minHeight))
    );
    handle.setAttribute(
      "aria-valuemax",
      String(Math.round(horizontal ? limits.maxWidth : limits.maxHeight))
    );
    // A corner adjusts both axes, so a single value would hide half of what the
    // handle does. The text alternative exposes width and height together.
    if (direction.x !== 0 && direction.y !== 0) {
      handle.setAttribute(
        "aria-valuetext",
        `${Math.round(rect.width)} × ${Math.round(rect.height)} px`
      );
    } else {
      handle.removeAttribute("aria-valuetext");
    }
  });
}

function applyLightboxSize(): void {
  const block = lightboxBlock;
  if (!block) {
    return;
  }
  block.style.width =
    lightboxWidth !== null ? `${lightboxWidth.toFixed(2)}px` : "";
  block.style.height =
    lightboxHeight !== null ? `${lightboxHeight.toFixed(2)}px` : "";
  const controller = activeController();
  if (controller && !lightboxSizeFrame) {
    lightboxSizeFrame = window.requestAnimationFrame(() => {
      lightboxSizeFrame = 0;
      controller.sync();
      controller.reposition();
      syncHandleAria();
    });
  }
}

function applyLightboxZoom(): void {
  if (!lightboxBlock) {
    return;
  }
  lightboxBlock.style.zoom = String(lightboxZoom);
  const reset = lightbox?.querySelector<HTMLElement>("[data-lb-zoom-reset]");
  if (reset) {
    reset.textContent = `${Math.round(lightboxZoom * 100)}%`;
  }
  clampLightboxPan();
  applyLightboxPan();
  const controller = activeController();
  window.requestAnimationFrame(() => {
    controller?.reposition();
    syncHandleAria();
  });
}

function lightboxNaturalWidth(): number {
  const controller = activeController();
  return controller?.naturalWidth() ?? 0;
}

function fitToStage(): void {
  if (!lightboxBlock || !stage) {
    return;
  }
  const padding = Number.parseFloat(window.getComputedStyle(stage).paddingLeft || "20") || 20;
  const available = Math.max(1, stage.clientWidth - padding * 2);
  const natural = lightboxWidth ?? lightboxNaturalWidth();
  const fit = natural > 0 && natural > available ? available / natural : 1;
  lightboxZoom = clampValue(fit, LIGHTBOX_MIN_ZOOM, 1);
  applyLightboxZoom();
}

/** Recenters and optionally drops the manual size and the zoom. */
function resetLightboxView(resetZoom: boolean): void {
  if (!lightboxBlock) {
    return;
  }
  // An explicit reset (double click or the 100% button) forgets the saved size
  // instead of persisting the default one, so the next open starts fresh.
  forgetLightboxSize();
  lightboxPanX = 0;
  lightboxPanY = 0;
  lightboxHeight = null;
  lightboxWidth = lightboxNaturalWidth() || lightboxBaseWidth || null;
  if (resetZoom) {
    lightboxZoom = 1;
    applyLightboxZoom();
  } else {
    applyLightboxPan();
  }
  applyLightboxSize();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(target.tagName);
}

function canStartPan(event: PointerEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element) || !lightboxBlock) {
    return false;
  }
  if (target.closest("[data-lb-handle]")) {
    return false;
  }
  if (event.button === 1) {
    return true;
  }
  if (event.button !== 0) {
    return false;
  }
  if (lightboxSpace) {
    return true;
  }
  if (target === stage || target === lightbox) {
    return true;
  }
  // The toolbar strip is the closest thing to a title band on the component
  // itself; dragging its background moves the table, its buttons stay buttons.
  if (target.closest(".mdprv-table-toolbar")) {
    return (
      target.closest("button, a, input, select, textarea, [role='separator']") ===
      null
    );
  }
  return false;
}

function onLightboxPointerMove(event: PointerEvent): void {
  if (lightboxResize) {
    const gesture = lightboxResize;
    if (event.pointerId !== gesture.pointerId) {
      return;
    }
    const limits = resizeLimits(gesture.zoom);
    let width = gesture.width;
    let height = gesture.height;
    if (gesture.horizontal !== 0) {
      // Symmetric resize: both edges move by the drag delta. Never force the
      // view to grow just because the zoomed-down view is below the 40% floor.
      width = clampValue(
        gesture.width +
          (2 * (event.clientX - gesture.startX) * gesture.horizontal) / gesture.zoom,
        Math.min(limits.width.min, gesture.width),
        limits.width.max
      );
    }
    if (gesture.vertical !== 0) {
      height = clampValue(
        gesture.height +
          (2 * (event.clientY - gesture.startY) * gesture.vertical) / gesture.zoom,
        Math.min(limits.height.min, gesture.height),
        limits.height.max
      );
    }
    if (
      Math.abs(event.clientX - gesture.startX) > 2 ||
      Math.abs(event.clientY - gesture.startY) > 2
    ) {
      gesture.moved = true;
    }
    lightboxWidth = width;
    if (gesture.vertical !== 0) {
      lightboxHeight = height;
    }
    applyLightboxSize();
    event.preventDefault();
    return;
  }
  if (!lightboxPan) {
    return;
  }
  const gesture = lightboxPan;
  if (event.pointerId !== gesture.pointerId) {
    return;
  }
  lightboxPanX = gesture.originX + (event.clientX - gesture.startX);
  lightboxPanY = gesture.originY + (event.clientY - gesture.startY);
  if (
    Math.abs(event.clientX - gesture.startX) > 3 ||
    Math.abs(event.clientY - gesture.startY) > 3
  ) {
    gesture.moved = true;
  }
  clampLightboxPan();
  applyLightboxPan();
  // Keep the dragged content tracking the pointer despite subpixel layout
  // shifts (zoom, clamping, sticky headers changing the scroll extent).
  if (lightboxBlock) {
    const rect = lightboxBlock.getBoundingClientRect();
    const driftX = event.clientX - gesture.startX - (rect.left - gesture.startLeft);
    const driftY = event.clientY - gesture.startY - (rect.top - gesture.startTop);
    if (Math.abs(driftX) > 0.25 || Math.abs(driftY) > 0.25) {
      lightboxPanX += driftX;
      lightboxPanY += driftY;
      clampLightboxPan();
      applyLightboxPan();
    }
  }
  activeController()?.reposition();
  event.preventDefault();
}

function onLightboxPointerUp(event: PointerEvent): void {
  if (lightboxResize && event.pointerId === lightboxResize.pointerId) {
    const moved = lightboxResize.moved;
    lightboxResize = null;
    lightbox?.classList.remove("mdprv-table-resizing");
    lightboxSuppressClick = moved;
    window.setTimeout(() => {
      lightboxSuppressClick = false;
    }, 0);
    activeController()?.reposition();
    syncHandleAria();
    // Persist once per gesture (not on every pointermove): a plain click on the
    // handle is not a resize and must not overwrite a saved size.
    if (moved) {
      lightboxSizeDirty = true;
      persistLightboxSize();
    }
    return;
  }
  if (lightboxPan && event.pointerId === lightboxPan.pointerId) {
    const moved = lightboxPan.moved;
    lightboxPan = null;
    lightbox?.classList.remove("mdprv-table-panning");
    lightboxSuppressClick = moved;
    window.setTimeout(() => {
      lightboxSuppressClick = false;
    }, 0);
    activeController()?.reposition();
  }
}

function openLightbox(block: HTMLElement): void {
  if (!lightbox || !stage || !frame || lightboxBlock === block) {
    return;
  }
  const controller = CONTROLLERS.get(block);
  if (!controller) {
    return;
  }
  lightboxFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  controller.closePopover(false);
  controller.closeChartPopover(false);
  lightboxMarker = document.createComment("mdprv-table-home");
  block.parentNode?.insertBefore(lightboxMarker, block);
  frame.append(block);
  lightboxBlock = block;
  lightboxZoom = 1;
  lightboxPanX = 0;
  lightboxPanY = 0;
  lightboxHeight = null;
  lightboxSizeDirty = false;
  const natural = controller.naturalWidth();
  lightboxBaseWidth = natural;
  lightboxWidth = natural > 0 ? natural : null;
  const saved = readSavedLightboxSize(
    block.getAttribute("data-mdprv-table-id") ?? ""
  );
  if (saved) {
    // Same bounds as the resize handles, evaluated at zoom 1 (the dialog always
    // opens there; fitToStage adjusts the zoom afterwards if the frame is wide).
    const limits = resizeLimits(1);
    if (saved.width !== null) {
      lightboxWidth = clampStoredSize(saved.width, limits.width);
    }
    if (saved.height !== null) {
      lightboxHeight = clampStoredSize(saved.height, limits.height);
    }
  }
  block.style.width =
    lightboxWidth !== null ? `${lightboxWidth.toFixed(2)}px` : "";
  block.style.height =
    lightboxHeight !== null ? `${lightboxHeight.toFixed(2)}px` : "";
  block.style.zoom = "1";
  frame.style.transform = "";
  stage.scrollTop = 0;
  stage.scrollLeft = 0;
  lightbox.classList.add("mdprv-open");
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("mdprv-table-lock");
  applyLightboxPan();
  window.setTimeout(() => {
    controller.sync();
    fitToStage();
    syncHandleAria();
    lightbox?.querySelector<HTMLElement>("[data-lb-close]")?.focus();
  }, reducedMotion() ? 0 : 60);
}

function closeLightbox(): void {
  if (!lightbox || !lightboxBlock) {
    return;
  }
  const block = lightboxBlock;
  const controller = CONTROLLERS.get(block) ?? null;
  controller?.closePopover(false);
  controller?.closeChartPopover(false);
  // Flush a keyboard resize that is still inside the debounce window; closing
  // without resetting keeps the saved size for the next open.
  persistLightboxSize();
  if (lightboxSizeFrame) {
    window.cancelAnimationFrame(lightboxSizeFrame);
    lightboxSizeFrame = 0;
  }
  lightboxPan = null;
  lightboxResize = null;
  lightboxSpace = false;
  lightboxSuppressClick = false;
  lightboxSizeDirty = false;
  if (lightboxSaveTimer) {
    window.clearTimeout(lightboxSaveTimer);
    lightboxSaveTimer = 0;
  }
  lightbox?.classList.remove(
    "mdprv-table-panning",
    "mdprv-table-resizing",
    "mdprv-table-space"
  );
  block.style.zoom = "";
  block.style.width = "";
  block.style.height = "";
  frame?.style.removeProperty("transform");
  if (lightboxMarker?.parentNode) {
    lightboxMarker.parentNode.insertBefore(block, lightboxMarker);
    lightboxMarker.parentNode.removeChild(lightboxMarker);
  } else if (frame && block.parentNode === frame) {
    frame.removeChild(block);
  }
  lightboxMarker = null;
  lightboxBlock = null;
  lightboxZoom = 1;
  lightboxPanX = 0;
  lightboxPanY = 0;
  lightboxWidth = null;
  lightboxHeight = null;
  lightboxBaseWidth = 0;
  if (stage) {
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
  }
  lightbox.classList.remove("mdprv-open");
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("mdprv-table-lock");
  if (controller) {
    window.requestAnimationFrame(() => controller.sync());
  }
  if (lightboxFocus && document.contains(lightboxFocus)) {
    lightboxFocus.focus();
  }
  lightboxFocus = null;
}

function lightboxFocusables(): HTMLElement[] {
  if (!lightbox) {
    return [];
  }
  const nodes = lightbox.querySelectorAll<HTMLElement>(
    "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
  );
  return Array.from(nodes).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") {
      return false;
    }
    return element.getClientRects().length > 0;
  });
}

function setupLightbox(): void {
  lightbox = document.getElementById("mdprv-table-lightbox");
  stage = document.getElementById("mdprv-table-stage");
  frame = document.getElementById("mdprv-table-frame");
  if (!lightbox || !stage || !frame) {
    return;
  }
  const close = lightbox.querySelector<HTMLElement>("[data-lb-close]");
  if (close && !close.innerHTML.trim()) {
    close.innerHTML = CLOSE_ICON;
  }

  /* --- resize handles: pointer drag + keyboard nudge --- */
  frame.querySelectorAll<HTMLElement>("[data-lb-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      if (!lightboxBlock || event.button !== 0) {
        return;
      }
      const kind = handle.getAttribute("data-lb-handle") ?? "";
      const direction = handleDirection(kind);
      const zoom = zoomFactor(lightboxBlock);
      const rect = lightboxBlock.getBoundingClientRect();
      lightboxResize = {
        pointerId: event.pointerId,
        handle: kind,
        startX: event.clientX,
        startY: event.clientY,
        width: rect.width / zoom,
        height: rect.height / zoom,
        zoom,
        horizontal: direction.x,
        vertical: direction.y,
        moved: false,
      };
      lightbox?.classList.add("mdprv-table-resizing");
      event.preventDefault();
      event.stopPropagation();
    });

    handle.addEventListener("keydown", (event) => {
      if (!lightboxBlock) {
        return;
      }
      const step = 16;
      const kind = handle.getAttribute("data-lb-handle") ?? "";
      const direction = handleDirection(kind);
      const horizontal =
        direction.x *
        (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0);
      const vertical =
        direction.y *
        (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0);
      if (horizontal === 0 && vertical === 0) {
        return;
      }
      const zoom = zoomFactor(lightboxBlock);
      const rect = lightboxBlock.getBoundingClientRect();
      const limits = resizeLimits(zoom);
      if (horizontal !== 0) {
        lightboxWidth = clampValue(
          rect.width / zoom + (horizontal * step) / zoom,
          Math.min(limits.width.min, rect.width / zoom),
          limits.width.max
        );
      }
      if (vertical !== 0) {
        lightboxHeight = clampValue(
          rect.height / zoom + (vertical * step) / zoom,
          Math.min(limits.height.min, rect.height / zoom),
          limits.height.max
        );
      }
      event.preventDefault();
      event.stopPropagation();
      lightboxSizeDirty = true;
      applyLightboxSize();
      scheduleLightboxSizeSave();
    });
  });

  /* --- pan: left on toolbar strip, middle anywhere, Space + drag --- */
  lightbox.addEventListener("pointerdown", (event) => {
    if (!lightbox?.classList.contains("mdprv-open")) {
      return;
    }
    if (lightboxPan || lightboxResize || !canStartPan(event)) {
      return;
    }
    event.preventDefault();
    const block = lightboxBlock;
    const rect = block?.getBoundingClientRect();
    lightboxPan = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: lightboxPanX,
      originY: lightboxPanY,
      startLeft: rect?.left ?? 0,
      startTop: rect?.top ?? 0,
      moved: false,
    };
    lightbox.classList.add("mdprv-table-panning");
    window.getSelection()?.removeAllRanges();
  });

  document.addEventListener("pointermove", onLightboxPointerMove);
  document.addEventListener("pointerup", onLightboxPointerUp);
  document.addEventListener("pointercancel", onLightboxPointerUp);

  lightbox.addEventListener("click", (event) => {
    if (lightboxSuppressClick) {
      lightboxSuppressClick = false;
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (target.closest("[data-lb-close]")) {
      closeLightbox();
      return;
    }
    if (target.closest("[data-lb-zoom-in]")) {
      lightboxZoom = Math.min(LIGHTBOX_MAX_ZOOM, lightboxZoom + LIGHTBOX_STEP);
      applyLightboxZoom();
      return;
    }
    if (target.closest("[data-lb-zoom-out]")) {
      lightboxZoom = Math.max(LIGHTBOX_MIN_ZOOM, lightboxZoom - LIGHTBOX_STEP);
      applyLightboxZoom();
      return;
    }
    if (target.closest("[data-lb-zoom-reset]")) {
      resetLightboxView(true);
      return;
    }
    if (target === lightbox || target === stage) {
      closeLightbox();
    }
  });

  /* Double click on the table or toolbar strip recenters the view and
     drops the manual size (the zoom is kept). */
  lightbox.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest(
        "button, a, input, select, textarea, [data-lb-handle], [data-lb-close], .mdprv-table-lb-tools"
      )
    ) {
      return;
    }
    if (target === lightbox) {
      return;
    }
    event.preventDefault();
    resetLightboxView(false);
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox?.classList.contains("mdprv-open")) {
      return;
    }
    if (event.key === "Escape") {
      const controller = activeController();
      if (controller?.popoverOpen()) {
        controller.closePopover(true);
        return;
      }
      if (controller?.chartPopoverOpen()) {
        controller.closeChartPopover(true);
        return;
      }
      event.preventDefault();
      closeLightbox();
      return;
    }
    if (event.code === "Space" && !isTypingTarget(event.target)) {
      lightboxSpace = true;
      lightbox.classList.add("mdprv-table-space");
      event.preventDefault();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = lightboxFocusables();
    if (focusables.length === 0) {
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (!lightbox.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "Space") {
      return;
    }
    lightboxSpace = false;
    lightbox?.classList.remove("mdprv-table-space");
  });

  window.addEventListener("blur", () => {
    lightboxSpace = false;
    lightbox?.classList.remove("mdprv-table-space");
  });

  // A reload or tab close can land inside the keyboard debounce window.
  window.addEventListener("pagehide", () => persistLightboxSize());

  window.addEventListener(
    "resize",
    debounce(() => {
      if (lightbox?.classList.contains("mdprv-open")) {
        clampLightboxPan();
        applyLightboxPan();
        syncHandleAria();
      }
    }, 150)
  );
}
export function initTable(): void {
  function run(): void {
    setupLightbox();
    const blocks = document.querySelectorAll<HTMLElement>("[data-mdprv-table]");
    const instances: TableController[] = [];
    blocks.forEach((block) => {
      const controller = setupTable(block);
      if (controller) {
        instances.push(controller);
      }
    });

    const root = document.documentElement;
    let globalRaw = root.classList.contains("mdprv-raw-open");
    let simple = root.classList.contains("mdprv-simple-tables");
    const observer = new MutationObserver(() => {
      const nextRaw = root.classList.contains("mdprv-raw-open");
      if (nextRaw !== globalRaw) {
        globalRaw = nextRaw;
        for (const controller of instances) {
          controller.setGlobalRaw(globalRaw);
        }
      }
      const nextSimple = root.classList.contains("mdprv-simple-tables");
      if (nextSimple !== simple) {
        simple = nextSimple;
        // CSS hides/shows the gutters; the island only has to re-measure so the
        // fullscreen frame and the chart keep the correct natural width.
        for (const controller of instances) {
          controller.sync();
          controller.reposition();
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
