/**
 * Widgets → Tabelas example.
 *
 * The preview is not hand-built chrome: it reuses the same server shell
 * (`renderGfmTableOpen`/`renderGfmTableClose`) and is booted by the table
 * island, so gutters, column headers and row numbers are measured from the
 * real grid instead of hard-coded widths. Keeping the dataset in a DOM-free
 * module lets the shape (columns, numeric column, row count) be tested
 * without a browser.
 */
import {
  renderGfmTableClose,
  renderGfmTableOpen,
} from "../../../../core/markdown/table";

/** Disjoint from the document's own sequence (`mdprv-table-1`, ...). */
export const TABLE_EXAMPLE_SEQ = 901;

export type TableExampleAlign = "left" | "center" | "right" | null;

export interface TableExample {
  headers: string[];
  align: TableExampleAlign[];
  rows: string[][];
}

/**
 * Four data rows, a right-aligned numeric column and cells long enough to
 * wrap when `mdprv_table_wrap` is on (and to truncate, without breaking, when
 * it is off). Headers stay short so they never need an ellipsis.
 */
export const TABLE_EXAMPLE: TableExample = {
  headers: ["Documento", "Seções", "Atualização", "Status"],
  align: [null, "right", null, null],
  rows: [
    [
      "Guia completo de estilo, componentes e padrões de interface do produto",
      "12",
      "27/11/2026 09:40",
      "Revisado",
    ],
    [
      "Notas da versão 2.4, correções pendentes e histórico de mudanças",
      "8",
      "26/11/2026 18:15",
      "Em revisão",
    ],
    [
      "Referência da API pública, parâmetros e exemplos de uso por recurso",
      "34",
      "25/11/2026 14:02",
      "Publicado",
    ],
    [
      "Manual de integração contínua, ambientes e solução de problemas",
      "5",
      "24/11/2026 11:30",
      "Rascunho",
    ],
  ],
};

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cellHtml(
  tag: "th" | "td",
  value: string,
  column: number,
  numeric: boolean,
  align: TableExampleAlign
): string {
  const scope = tag === "th" ? ' scope="col"' : "";
  const role = tag === "th" ? "columnheader" : "gridcell";
  const numericAttr = tag === "td" && numeric ? ' data-mdprv-num="1"' : "";
  const alignAttr = align ? ` style="text-align: ${align}"` : "";
  return (
    `<${tag} role="${role}"${scope} aria-colindex="${column + 1}"` +
    `${numericAttr}${alignAttr}>${escapeText(value)}</${tag}>`
  );
}

/** Full trusted markup for the example, ready for `innerHTML`. */
export function tableExampleMarkup(): string {
  const { headers, align, rows } = TABLE_EXAMPLE;
  const head = headers
    .map((label, column) => cellHtml("th", label, column, false, align[column] ?? null))
    .join("");
  const body = rows
    .map((row, index) => {
      const cells = row
        .map((value, column) =>
          cellHtml("td", value, column, align[column] === "right", align[column] ?? null)
        )
        .join("");
      return `<tr role="row" aria-rowindex="${index + 2}">${cells}</tr>`;
    })
    .join("");
  const table =
    `<table class="mdprv-grid" id="mdprv-table-${TABLE_EXAMPLE_SEQ}-grid" ` +
    `role="grid" aria-label="Tabela de exemplo com ${headers.length} colunas e ${rows.length} linhas" ` +
    `aria-rowcount="${rows.length + 1}" aria-colcount="${headers.length}">` +
    `<thead><tr role="row" aria-rowindex="1">${head}</tr></thead>` +
    `<tbody>${body}</tbody>` +
    `</table>`;
  return renderGfmTableOpen(TABLE_EXAMPLE_SEQ) + table + renderGfmTableClose();
}
