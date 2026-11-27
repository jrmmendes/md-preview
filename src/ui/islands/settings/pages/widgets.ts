/**
 * Página Widgets (Fase 7): zoom dos gráficos, tabela simples e diff simples.
 *
 * A página só lê o rascunho do modal: cada controle chama o callback do
 * `index.ts`, que atualiza o snapshot em memória. Cookies, `localStorage` e
 * classes globais só mudam quando o usuário salva.
 */
import { getZoomSensitivity } from "../../../prefs";
import type { WidgetAnchor } from "../routes";
import { el, sectionHeader, switchRow } from "../components";

const ZOOM_MIN = 1.01;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.05;
const ZOOM_DEFAULT = 1.1;

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) {
    return ZOOM_DEFAULT;
  }
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

export function formatZoom(value: number): string {
  return String(Number(value.toFixed(2)));
}

/** Effective zoom at page load, used as the applied baseline. */
export function currentZoom(): number {
  const stored = getZoomSensitivity();
  if (stored !== null) {
    return clampZoom(stored);
  }
  const attr = Number.parseFloat(
    document.documentElement.getAttribute("data-zoom-sensitivity") ?? ""
  );
  return Number.isFinite(attr) ? clampZoom(attr) : ZOOM_DEFAULT;
}

function zoomControl(initial: number, onChange: (value: number) => void): HTMLElement {
  const inputId = "mdprv-settings-widgets-zoom";
  const output = el("output", { class: "mdprv-settings-range-value", for: inputId }, formatZoom(initial));
  const progress = (value: number): string =>
    `${((value - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN)) * 100}%`;

  const input = el("input", {
    type: "range",
    class: "mdprv-settings-range",
    id: inputId,
    min: String(ZOOM_MIN),
    max: String(ZOOM_MAX),
    step: String(ZOOM_STEP),
    value: String(initial),
    "aria-describedby": "mdprv-settings-widgets-zoom-desc",
  });
  input.style.setProperty("--range-progress", progress(initial));

  input.addEventListener("input", () => {
    const next = clampZoom(Number(input.value));
    output.textContent = formatZoom(next);
    input.style.setProperty("--range-progress", progress(next));
    onChange(next);
  });

  return el(
    "div",
    { class: "mdprv-settings-range-control" },
    el(
      "div",
      { class: "mdprv-settings-range-head" },
      el(
        "label",
        { class: "mdprv-settings-range-label", for: inputId },
        "Sensibilidade do zoom"
      ),
      output
    ),
    input,
    el(
      "p",
      { class: "mdprv-settings-range-desc", id: "mdprv-settings-widgets-zoom-desc" },
      "Quanto o scroll amplia ou reduz os diagramas Mermaid na tela cheia. De 1,01 a 3, em passos de 0,05."
    )
  );
}

function sheetTag(label: string): HTMLElement {
  return el("span", { class: "mdprv-sheet-tag", "aria-hidden": "true" }, label);
}

function tablePreview(): HTMLElement {
  const table = el(
    "table",
    {
      class: "mdprv-grid",
      role: "grid",
      "aria-label": "Tabela de exemplo com três colunas e duas linhas de dados",
      "aria-rowcount": "3",
      "aria-colcount": "3",
    },
    el(
      "thead",
      {},
      el(
        "tr",
        { role: "row", "aria-rowindex": "1" },
        el("th", { role: "columnheader", scope: "col", "aria-colindex": "1" }, "Documento"),
        el("th", { role: "columnheader", scope: "col", "aria-colindex": "2" }, "Seções"),
        el("th", { role: "columnheader", scope: "col", "aria-colindex": "3" }, "Atualização")
      )
    ),
    el(
      "tbody",
      {},
      el(
        "tr",
        { role: "row", "aria-rowindex": "2" },
        el("td", { role: "gridcell", "aria-colindex": "1" }, "Guia de estilo"),
        el("td", { role: "gridcell", "aria-colindex": "2", dataset: { mdprvNum: "1" } }, "12"),
        el("td", { role: "gridcell", "aria-colindex": "3" }, "hoje")
      ),
      el(
        "tr",
        { role: "row", "aria-rowindex": "3" },
        el("td", { role: "gridcell", "aria-colindex": "1" }, "Notas 2.4"),
        el("td", { role: "gridcell", "aria-colindex": "2", dataset: { mdprvNum: "1" } }, "8"),
        el("td", { role: "gridcell", "aria-colindex": "3" }, "ontem")
      )
    )
  );

  return el(
    "div",
    {
      class: "mdprv-table",
      dataset: {
        mdprvTable: "",
        mdprvTableHeaderRow: "1",
        mdprvTableHeaderCol: "0",
        mdprvTablePivot: "0",
        mdprvTableReady: "1",
      },
    },
    el(
      "div",
      { class: "mdprv-sheet" },
      el("div", { class: "mdprv-sheet-corner", "aria-hidden": "true" }),
      el(
        "div",
        { class: "mdprv-sheet-colhead", role: "row", "aria-label": "Colunas" },
        el(
          "div",
          { class: "mdprv-sheet-track" },
          sheetTag("A"),
          sheetTag("B"),
          sheetTag("C")
        )
      ),
      el(
        "div",
        { class: "mdprv-sheet-rowhead", role: "row", "aria-label": "Linhas" },
        el(
          "div",
          { class: "mdprv-sheet-track" },
          sheetTag("1"),
          sheetTag("2")
        )
      ),
      el("div", { class: "mdprv-sheet-body" }, table)
    )
  );
}

function diffRow(
  kind: "meta" | "add" | "del",
  text: string
): HTMLElement {
  if (kind === "meta") {
    return el(
      "tr",
      { class: "mdprv-diff-row is-meta", dataset: { diffKind: "meta" } },
      el("td", { class: "mdprv-diff-meta", colspan: "2" }, text)
    );
  }
  return el(
    "tr",
    { class: `mdprv-diff-row is-${kind}`, dataset: { diffKind: kind } },
    el("td", { class: `mdprv-diff-mark is-${kind}` }, kind === "add" ? "+" : "-"),
    el("td", { class: `mdprv-diff-code is-${kind}` }, text)
  );
}

function diffPreview(): HTMLElement {
  return el(
    "div",
    { class: "mdprv-diff" },
    el(
      "div",
      { class: "mdprv-diff-pane mdprv-diff-pane--inline", dataset: { diffPane: "inline" } },
      el(
        "table",
        {
          class: "mdprv-diff-table mdprv-diff-table--inline",
          "aria-label": "Exemplo de diff com duas linhas removidas e duas adicionadas",
        },
        el(
          "tbody",
          {},
          diffRow("meta", "config.json"),
          diffRow("del", "  port: 8766"),
          diffRow("del", "  idle: 15"),
          diffRow("add", "  port: 8765"),
          diffRow("add", "  idle: 30")
        )
      )
    )
  );
}

function widgetBlock(options: {
  id: WidgetAnchor;
  title: string;
  description: string;
  children: HTMLElement[];
}): HTMLElement {
  return el(
    "section",
    {
      class: "mdprv-settings-widget-block",
      id: `mdprv-settings-widgets-${options.id}`,
      dataset: { widget: options.id },
    },
    el(
      "div",
      { class: "mdprv-settings-widget-head" },
      el("h2", {}, options.title),
      el("p", {}, options.description)
    ),
    ...options.children
  );
}

export interface WidgetsContext {
  anchor: WidgetAnchor | null;
  zoom: number;
  simpleTables: boolean;
  simpleDiffs: boolean;
  tableWrap: boolean;
  onZoom(value: number): void;
  onSimpleTables(value: boolean): void;
  onSimpleDiffs(value: boolean): void;
  onTableWrap(value: boolean): void;
}

export function renderWidgetsPage(ctx: WidgetsContext): HTMLElement {
  const tableToggle = switchRow({
    label: "Modo de tabela simples",
    description: "oculta as letras, os números e a moldura de planilha.",
    checked: ctx.simpleTables,
    onChange: (checked) => ctx.onSimpleTables(checked),
  });

  const wrapToggle = switchRow({
    label: "Quebra automática de linhas",
    description: "faz células e cabeçalhos longos quebrarem em várias linhas em vez de truncar.",
    checked: ctx.tableWrap,
    onChange: (checked) => ctx.onTableWrap(checked),
  });

  const diffToggle = switchRow({
    label: "Modo de diff simples",
    description: "oculta os metadados de arquivo e os cabeçalhos de hunk.",
    checked: ctx.simpleDiffs,
    onChange: (checked) => ctx.onSimpleDiffs(checked),
  });

  const page = el(
    "div",
    { class: "mdprv-settings-page" },
    sectionHeader({
      title: "Widgets",
      description: "Gráficos, tabelas e diffs do documento.",
    }),
    widgetBlock({
      id: "graficos",
      title: "Gráficos",
      description: "Sensibilidade do zoom usada nos diagramas Mermaid.",
      children: [zoomControl(ctx.zoom, (value) => ctx.onZoom(value))],
    }),
    widgetBlock({
      id: "tabelas",
      title: "Tabelas",
      description: "Como as tabelas do documento são renderizadas.",
      children: [
        tableToggle,
        wrapToggle,
        el(
          "div",
          {
            class: "mdprv-settings-widget-preview",
            dataset: { preview: "tables" },
          },
          tablePreview()
        ),
      ],
    }),
    widgetBlock({
      id: "diff",
      title: "Diff",
      description: "Como os blocos de diff são exibidos.",
      children: [
        diffToggle,
        el(
          "div",
          {
            class: "mdprv-settings-widget-preview",
            dataset: { preview: "diffs" },
          },
          diffPreview()
        ),
      ],
    })
  );

  if (ctx.anchor) {
    page.dataset.section = ctx.anchor;
  }
  return page;
}
