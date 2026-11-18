import { describe, expect, it } from "bun:test";

import {
  buildChartData,
  buildColumnValues,
  chartUnavailableReason,
  clampColumnWidth,
  columnLetter,
  DEFAULT_CHART_PALETTE_DARK,
  DEFAULT_CHART_PALETTE_LIGHT,
  escapeMarkdownCell,
  filterRows,
  isNumericColumn,
  normalizeCellText,
  normalizeRange,
  normalizeValueKey,
  numericChartColumns,
  numericKey,
  parseCsv,
  parseMarkdownTable,
  pivotTable,
  resolveChartPalette,
  resolveRawMode,
  sanitizeSpreadsheetCell,
  serializeCsv,
  serializeMarkdownTable,
  serializeTsv,
  sortOrder,
  splitTableRow,
  TABLE_MIN_COLUMN_WIDTH,
} from "../src/shared/table";

describe("normalizeCellText", () => {
  it("lowercases, strips diacritics and collapses whitespace", () => {
    expect(normalizeCellText("  São   PAULO ")).toBe("sao paulo");
    expect(normalizeCellText("AÇÃO")).toBe("acao");
    expect(normalizeCellText("")).toBe("");
  });
});

describe("normalizeValueKey", () => {
  it("maps empty cells to the em dash bucket", () => {
    expect(normalizeValueKey("")).toBe("—");
    expect(normalizeValueKey("  ")).toBe("—");
    expect(normalizeValueKey("São")).toBe("sao");
  });
});

describe("columnLetter", () => {
  it("produces spreadsheet labels", () => {
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
    expect(columnLetter(701)).toBe("ZZ");
    expect(columnLetter(-1)).toBe("");
  });
});

describe("splitTableRow", () => {
  it("honors escaped pipes and optional outer pipes", () => {
    expect(splitTableRow("| A | B |")).toEqual(["A", "B"]);
    expect(splitTableRow("A | B")).toEqual(["A", "B"]);
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
    expect(splitTableRow("| a \\\\| b |")).toEqual(["a \\", "b"]);
  });
});

describe("parseMarkdownTable", () => {
  it("parses headers, rows and alignment", () => {
    const model = parseMarkdownTable(
      "| Nome | Valor |\n| :--- | ---: |\n| A | 1 |\n| B | 2 |\n"
    );
    expect(model).not.toBeNull();
    expect(model?.header).toEqual(["Nome", "Valor"]);
    expect(model?.align).toEqual(["left", "right"]);
    expect(model?.rows).toEqual([
      ["A", "1"],
      ["B", "2"],
    ]);
  });

  it("returns null for non-tables", () => {
    expect(parseMarkdownTable("not a table")).toBeNull();
    expect(parseMarkdownTable("| A | B |\n| nope | nope |")).toBeNull();
  });
});

describe("parseCsv", () => {
  it("parses quoted fields, embedded delimiters and newlines", () => {
    const model = parseCsv('nome,obs\n"Silva, Ana","linha 1\nlinha 2"\n"Bia","diz ""oi"""\n');
    expect(model).not.toBeNull();
    expect(model?.header).toEqual(["nome", "obs"]);
    expect(model?.rows[0]).toEqual(["Silva, Ana", "linha 1\nlinha 2"]);
    expect(model?.rows[1]).toEqual(["Bia", 'diz "oi"']);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3\n")?.header).toEqual(["a", "b", "c"]);
    expect(parseCsv("a\tb\n1\t2\n")?.header).toEqual(["a", "b"]);
  });

  it("pads short rows to the widest row", () => {
    const model = parseCsv("a,b\n1\n2,3,4\n");
    expect(model?.header).toEqual(["a", "b", ""]);
    expect(model?.rows).toEqual([
      ["1", "", ""],
      ["2", "3", "4"],
    ]);
  });

  it("rejects empty input and unterminated quotes", () => {
    expect(parseCsv("")).toBeNull();
    expect(parseCsv("   \n")).toBeNull();
    expect(parseCsv('a,b\n"unterminated,2\n')).toBeNull();
  });
});

describe("serializeMarkdownTable", () => {
  it("escapes pipes and writes alignment delimiters", () => {
    const markdown = serializeMarkdownTable({
      header: ["A|B", "C"],
      rows: [["x", "y\nz"]],
      align: ["center", "right"],
    });
    expect(markdown).toBe(
      ["| A\\|B | C |", "| :---: | ---: |", "| x | y z |"].join("\n")
    );
  });

  it("pads rows to the header width", () => {
    const markdown = serializeMarkdownTable({
      header: ["A", "B", "C"],
      rows: [["1"]],
      align: [],
    });
    expect(markdown).toContain("| 1 |  |  |");
  });
});

describe("escapeMarkdownCell", () => {
  it("escapes backslashes, pipes and line breaks", () => {
    expect(escapeMarkdownCell("a\\b|c\nd")).toBe("a\\\\b\\|c d");
  });
});

describe("serializeTsv", () => {
  const rows = [
    ["A", "B", "C"],
    ["1", "2", "3"],
    ["4", "5", "6"],
  ];

  it("serializes every row without a range", () => {
    expect(serializeTsv(rows)).toBe("A\tB\tC\n1\t2\t3\n4\t5\t6");
  });

  it("serializes and clamps a rectangle", () => {
    expect(serializeTsv(rows, { r1: 1, c1: 1, r2: 2, c2: 2 })).toBe(
      "2\t3\n5\t6"
    );
    expect(serializeTsv(rows, { r1: -5, c1: 1, r2: 99, c2: 99 })).toBe(
      "B\tC\n2\t3\n5\t6"
    );
  });

  it("returns an empty string for an empty table", () => {
    expect(serializeTsv([], { r1: 0, c1: 0, r2: 2, c2: 2 })).toBe("");
  });

  it("mitigates formula injection while keeping negative numbers", () => {
    expect(serializeTsv([["=SUM(A1)", "-1", "@cmd"]])).toBe(
      "'=SUM(A1)\t-1\t'@cmd"
    );
    expect(
      serializeTsv([["=1"]], null, { mitigateFormulas: false })
    ).toBe("=1");
  });
});

describe("serializeCsv", () => {
  it("writes comma-separated rows with LF by default and no BOM", () => {
    const csv = serializeCsv([
      ["Nome", "Receita"],
      ["Ana", "1.200"],
    ]);
    expect(csv).toBe("Nome,Receita\nAna,1.200");
    expect(csv.startsWith("\uFEFF")).toBe(false);
  });

  it("quotes commas, quotes and line breaks and doubles inner quotes", () => {
    const csv = serializeCsv([["Silva, Ana", 'diz "oi"', "linha 1\nlinha 2"]]);
    expect(csv).toBe('"Silva, Ana","diz ""oi""","linha 1\nlinha 2"');
  });

  it("supports CRLF output explicitly", () => {
    expect(serializeCsv([["a"], ["b"]], { eol: "\r\n" })).toBe("a\r\nb");
  });

  it("mitigates formula injection and keeps plain negative numbers", () => {
    expect(
      serializeCsv([["=1+1", "-3,5", "+4", "@x", "ok"]])
    ).toBe("'=1+1,\"-3,5\",'+4,'@x,ok");
    expect(sanitizeSpreadsheetCell("-42")).toBe("-42");
    expect(sanitizeSpreadsheetCell("-R$ 3")).toBe("'-R$ 3");
    expect(sanitizeSpreadsheetCell("\tcmd")).toBe("'\tcmd");
    expect(sanitizeSpreadsheetCell("texto")).toBe("texto");
  });

  it("returns an empty string for no rows", () => {
    expect(serializeCsv([])).toBe("");
  });
});

describe("chart model", () => {
  const model = {
    header: ["Cidade", "Receita", "Custo"],
    rows: [
      ["São Paulo", "120", "80"],
      ["Rio", "90", ""],
      ["Recife", "-10", "30"],
    ],
    align: [],
  };

  it("finds numeric columns and falls back to the letter as label", () => {
    expect(numericChartColumns(model)).toEqual([
      { index: 1, label: "Receita" },
      { index: 2, label: "Custo" },
    ]);
  });

  it("builds categories and one numeric series", () => {
    const data = buildChartData(model, { categoryColumn: 0, valueColumn: 1 });
    expect(data).not.toBeNull();
    expect(data?.categories).toEqual(["São Paulo", "Rio", "Recife"]);
    expect(data?.series).toEqual([{ name: "Receita", values: [120, 90, -10] }]);
    expect(data?.valueLabel).toBe("Receita");
    expect(data?.categoryLabel).toBe("Cidade");
  });

  it("keeps gaps as null and labels empty categories", () => {
    const data = buildChartData(
      { header: ["Cidade", "Receita"], rows: [["", "1"], ["B", ""]], align: [] },
      { valueColumn: 1 }
    );
    expect(data?.categories).toEqual(["—", "B"]);
    expect(data?.series[0]?.values).toEqual([1, null]);
  });

  it("keeps charts usable when the first-row header is disabled", () => {
    const headerless = {
      header: [] as string[],
      rows: [
        ["Cidade", "Receita"],
        ["São Paulo", "120"],
        ["Rio", "90"],
      ],
      align: [],
    };
    expect(numericChartColumns(headerless)).toEqual([{ index: 1, label: "B" }]);
    const data = buildChartData(headerless, { valueColumn: 1 });
    expect(data?.categories).toEqual(["Cidade", "São Paulo", "Rio"]);
    expect(data?.series[0]?.values).toEqual([null, 120, 90]);
  });

  it("returns null when there is no numeric series", () => {
    expect(
      buildChartData({ header: ["A"], rows: [["texto"]], align: [] })
    ).toBeNull();
  });

  it("disables pie for negatives and too many categories", () => {
    const data = buildChartData(model, { valueColumn: 1 })!;
    expect(chartUnavailableReason("pie", data)).toContain("negativos");
    const many = buildChartData(
      {
        header: ["Categoria", "Valor"],
        rows: Array.from({ length: 13 }, (_, index) => [`C${index}`, "1"]),
        align: [],
      },
      { valueColumn: 1 }
    )!;
    expect(chartUnavailableReason("pie", many)).toContain("12 categorias");
    expect(chartUnavailableReason("bar", many)).toBeNull();
  });

  it("requires two points for line, area and scatter", () => {
    const single = buildChartData(
      { header: ["Categoria", "Valor"], rows: [["A", "1"]], align: [] },
      { valueColumn: 1 }
    )!;
    expect(chartUnavailableReason("line", single)).not.toBeNull();
    expect(chartUnavailableReason("bar", single)).toBeNull();
  });
});

describe("resolveChartPalette", () => {
  it("uses the light/dark built-in palette when absent", () => {
    expect(resolveChartPalette(undefined, "light")).toEqual([
      ...DEFAULT_CHART_PALETTE_LIGHT,
    ]);
    expect(resolveChartPalette(undefined, "dark")).toEqual([
      ...DEFAULT_CHART_PALETTE_DARK,
    ]);
  });

  it("accepts a valid palette and falls back for invalid values", () => {
    expect(resolveChartPalette(["#fff", "rgb(1, 2, 3)"])).toEqual([
      "#fff",
      "rgb(1, 2, 3)",
    ]);
    expect(resolveChartPalette(["red"], "dark")).toEqual([...DEFAULT_CHART_PALETTE_DARK]);
    expect(resolveChartPalette([], "dark")).toEqual([...DEFAULT_CHART_PALETTE_DARK]);
    expect(resolveChartPalette("nope")).toEqual([...DEFAULT_CHART_PALETTE_LIGHT]);
  });
});

describe("pivotTable", () => {
  it("transposes header and rows", () => {
    const pivot = pivotTable({
      header: ["Nome", "A", "B"],
      rows: [
        ["L1", "a1", "b1"],
        ["L2", "a2", "b2"],
      ],
      align: ["left", "right", null],
    });
    expect(pivot.header).toEqual(["Nome", "L1", "L2"]);
    expect(pivot.rows).toEqual([
      ["A", "a1", "a2"],
      ["B", "b1", "b2"],
    ]);
    expect(pivot.align).toEqual([null, null, null]);
  });
});

describe("numericKey", () => {
  it("parses pt-BR numbers and common decorations", () => {
    expect(numericKey("128.402")).toBe(128402);
    expect(numericKey("4,1 %")).toBe(4.1);
    expect(numericKey("R$ 1.234,56")).toBe(1234.56);
    expect(numericKey("-3,5")).toBe(-3.5);
    expect(numericKey("3.14")).toBe(3.14);
  });

  it("rejects dates, free text and placeholders", () => {
    expect(numericKey("12/08/2026")).toBeNull();
    expect(numericKey("2 campos")).toBeNull();
    expect(numericKey("—")).toBeNull();
    expect(numericKey("")).toBeNull();
  });
});

describe("isNumericColumn", () => {
  it("accepts numbers with empty placeholders", () => {
    expect(isNumericColumn(["1", "2,5", "", "—", "R$ 3,00"])).toBe(true);
  });

  it("rejects mixed text", () => {
    expect(isNumericColumn(["1", "dois"])).toBe(false);
    expect(isNumericColumn(["", "—"])).toBe(false);
  });
});

describe("sortOrder", () => {
  const rows = [
    ["b", "2"],
    ["a", "10"],
    ["c", "1"],
  ];

  it("sorts text naturally", () => {
    expect(sortOrder(rows, 0, "asc")).toEqual([1, 0, 2]);
  });

  it("sorts numeric columns by value and stays stable", () => {
    expect(sortOrder(rows, 1, "asc", { numeric: true })).toEqual([2, 0, 1]);
    expect(sortOrder(rows, 1, "desc", { numeric: true })).toEqual([1, 0, 2]);
  });
});

describe("buildColumnValues", () => {
  it("groups case/accent variants and orders by label", () => {
    const values = buildColumnValues(["São", "sao", "Rio", "—", ""]);
    expect(values).toEqual([
      { key: "—", label: "—", count: 2 },
      { key: "rio", label: "Rio", count: 1 },
      { key: "sao", label: "São", count: 2 },
    ]);
  });
});

describe("filterRows", () => {
  const rows = [
    ["São Paulo", "Falha"],
    ["Rio", "Ok"],
    ["", "Falha"],
  ];
  const normalized = rows.map((row) => row.map((cell) => normalizeCellText(cell)));

  it("matches accent-insensitively across the row", () => {
    expect(filterRows(rows, { query: "sao" })).toEqual([true, false, false]);
    expect(filterRows(rows, { query: "falha" })).toEqual([true, false, true]);
  });

  it("applies per-column value filters", () => {
    const filters = new Map<number, Set<string>>([
      [1, new Set([normalizeValueKey("Falha")])],
    ]);
    expect(filterRows(rows, { columnFilters: filters, normalized })).toEqual([
      true,
      false,
      true,
    ]);
  });

  it("can skip the row-header column in the global search", () => {
    expect(filterRows(rows, { query: "sao", excludeColumn: 0 })).toEqual([
      false,
      false,
      false,
    ]);
  });
});

describe("clampColumnWidth", () => {
  it("respects the minimum and maximum", () => {
    expect(clampColumnWidth(10)).toBe(TABLE_MIN_COLUMN_WIDTH);
    expect(clampColumnWidth(100)).toBe(100);
    expect(clampColumnWidth(1000, 48, 400)).toBe(400);
    expect(clampColumnWidth(Number.NaN)).toBe(TABLE_MIN_COLUMN_WIDTH);
  });
});

describe("normalizeRange", () => {
  it("puts the top-left corner first", () => {
    expect(normalizeRange({ r1: 3, c1: 4, r2: 1, c2: 2 })).toEqual({
      r1: 1,
      c1: 2,
      r2: 3,
      c2: 4,
    });
  });
});

describe("resolveRawMode", () => {
  it("combines the block toggle with the global raw view", () => {
    expect(resolveRawMode(false, false)).toEqual({ raw: false, locked: false });
    expect(resolveRawMode(true, false)).toEqual({ raw: true, locked: false });
    expect(resolveRawMode(false, true)).toEqual({ raw: true, locked: true });
    expect(resolveRawMode(true, true)).toEqual({ raw: true, locked: true });
  });
});
