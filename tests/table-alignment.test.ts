import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isNumericColumn } from "../src/shared/table";
import {
  TABLE_EXAMPLE,
  tableExampleMarkup,
} from "../src/ui/islands/settings/previews/table-example";

const tableSource = readFileSync(
  join(import.meta.dir, "../src/ui/islands/table.ts"),
  "utf8"
);
const widgetsSource = readFileSync(
  join(import.meta.dir, "../src/ui/islands/settings/pages/widgets.ts"),
  "utf8"
);
const settingsSource = readFileSync(
  join(import.meta.dir, "../src/ui/islands/settings/index.ts"),
  "utf8"
);

describe("table gutter sync", () => {
  it("re-measures when the table box changes, not only on window resize", () => {
    expect(tableSource).toContain("new ResizeObserver");
    expect(tableSource).toMatch(/\.observe\(block\)/);
    expect(tableSource).toContain("invalidate");
    expect(tableSource).toContain("initTablesIn");
  });

  it("never relies on svg nodes to find column or header anchors", () => {
    expect(tableSource).not.toMatch(
      /querySelector(?:All)?(?:<[^>]*>)?\(\s*["'`][^"'`]*svg/
    );
    expect(tableSource).not.toContain('"svg"');
    expect(tableSource).not.toContain("'svg'");
  });

  it("derives header widths and row heights from the rendered grid", () => {
    const sync =
      tableSource
        .split("const syncGutterSizes = (): void => {")[1]
        ?.split("const requestSync")[0] ?? "";
    // Header letters and body share `colElements()`; row numbers read the same
    // `<thead>/<tbody>` rows as the grid, so there is no second width source.
    expect(sync).toContain("const cols = colElements();");
    expect(sync).toContain("column.getBoundingClientRect().width / z");
    expect(sync).toContain("row.getBoundingClientRect().height / z");
    expect(sync).toMatch(/\)\.style\.width\s*=/);
    expect(sync).toContain("tag.style.height");
    expect(sync).toContain("syncGutterScroll()");
  });

  it("boots preview tables through the island instead of static ready markup", () => {
    expect(widgetsSource).toContain("tableExampleMarkup()");
    expect(widgetsSource).not.toContain('mdprvTableReady: "1"');
    expect(settingsSource).toContain("initTablesIn(content)");
    expect(settingsSource).toContain("syncTablesIn(node)");
  });
});

describe("settings table example", () => {
  it("has four coherent data rows", () => {
    expect(TABLE_EXAMPLE.rows).toHaveLength(4);
    for (const row of TABLE_EXAMPLE.rows) {
      expect(row).toHaveLength(TABLE_EXAMPLE.headers.length);
    }
    expect(TABLE_EXAMPLE.align).toHaveLength(TABLE_EXAMPLE.headers.length);
  });

  it("exercises the numeric/right-aligned column", () => {
    const numericColumn = TABLE_EXAMPLE.align.findIndex(
      (align) => align === "right"
    );
    expect(numericColumn).toBeGreaterThanOrEqual(0);
    expect(
      isNumericColumn(TABLE_EXAMPLE.rows.map((row) => row[numericColumn] ?? ""))
    ).toBe(true);
  });

  it("keeps headers short enough to avoid truncation", () => {
    for (const header of TABLE_EXAMPLE.headers) {
      expect(header.length).toBeLessThanOrEqual(14);
    }
  });

  it("renders one cell per column with no merged cells", () => {
    const markup = tableExampleMarkup();
    expect((markup.match(/<th /g) ?? [])).toHaveLength(
      TABLE_EXAMPLE.headers.length
    );
    expect((markup.match(/<tr /g) ?? [])).toHaveLength(
      TABLE_EXAMPLE.rows.length + 1
    );
    expect((markup.match(/<td /g) ?? [])).toHaveLength(
      TABLE_EXAMPLE.rows.length * TABLE_EXAMPLE.headers.length
    );
    expect(markup).not.toContain("colspan");
    expect(markup).not.toContain("rowspan");
  });

  it("uses the real table shell so the island owns the gutters", () => {
    const markup = tableExampleMarkup();
    expect(markup).toContain("<div class=\"mdprv-table\" data-mdprv-table ");
    expect(markup).toContain("data-mdprv-colhead");
    expect(markup).toContain("data-mdprv-rowhead");
    expect(markup).toContain("data-mdprv-sheet-body");
    expect(markup).toContain("mdprv-table-toolbar");
    expect(markup).not.toContain("data-mdprv-table-ready");
  });
});
