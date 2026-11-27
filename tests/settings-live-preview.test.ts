import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { widgetPreviewClasses } from "../src/ui/islands/settings/previews/widget-classes";

function ui(path: string): string {
  return readFileSync(join(import.meta.dir, "../src/ui", path), "utf8");
}

function block(
  source: string,
  marker: string,
  end = /\n {2}\},?\n/
): string {
  const rest = source.split(marker)[1] ?? "";
  const index = rest.search(end);
  return index === -1 ? rest : rest.slice(0, index);
}

describe("settings live previews", () => {
  const index = ui("islands/settings/index.ts");

  it("repaints the chart example without rendering the page", () => {
    const changeExample = block(index, "function changeExample");
    expect(changeExample).toContain("chartsPreview?.setExample(id)");
    expect(changeExample).toContain("sessionSet(EXAMPLE_KEY, id)");
    expect(changeExample).not.toContain("render(");
  });

  it("persists the example only for the session", () => {
    expect(index).toContain('const EXAMPLE_KEY = "mdprv_settings_chart_example"');
    const read = block(index, "function lastExample");
    expect(read).toContain("sessionGet(EXAMPLE_KEY)");
    expect(index).not.toContain("localSet(EXAMPLE_KEY");
  });

  it("selects a theme without re-rendering or resetting the scroll", () => {
    const selectTheme = block(index, "function selectTheme");
    expect(selectTheme).toContain("setDraftTheme");
    expect(selectTheme).not.toContain("render(");
  });

  it("applies the widget toggles to the preview wrapper in real time", () => {
    for (const name of ["changeSimpleTables", "changeSimpleDiffs", "changeTableWrap"]) {
      expect(block(index, `function ${name}`)).toContain(
        "syncWidgetPreviewClasses(draft)"
      );
    }
    const sync = block(index, "function syncWidgetPreviewClasses");
    expect(sync).toContain('querySelectorAll<HTMLElement>("[data-preview]")');
    expect(sync).toContain("widgetPreviewClasses(target, snapshot)");
    // The classes never go to <html>, so table.ts never re-measures real tables.
    expect(sync).not.toContain("documentElement");
  });

  it("rolls the widget classes back when the modal closes", () => {
    const close = block(index, "onClose: () =>", /\n {4}\},\n/);
    expect(close).toContain("discardSnapshot(applied)");
    expect(close).toContain("syncWidgetPreviewClasses(draft)");
  });

  it("skips the catalog re-render while an import form holds JSON", () => {
    expect(index).toContain("importFormHasContent()");
    expect(index).toContain("renderPreservingView(modal.currentRoute())");
    expect(index).not.toContain("render(modal.currentRoute())");
  });

  it("maps preview targets to scoped classes", () => {
    const state = { simpleTables: false, simpleDiffs: false, tableWrap: false };
    expect(widgetPreviewClasses("tables", state)).toEqual([]);
    expect(widgetPreviewClasses("diffs", state)).toEqual([]);
    expect(
      widgetPreviewClasses("tables", {
        ...state,
        simpleTables: true,
        tableWrap: true,
        simpleDiffs: true,
      })
    ).toEqual(["mdprv-simple-tables", "mdprv-wrap-cells"]);
    expect(
      widgetPreviewClasses("diffs", { ...state, simpleDiffs: true })
    ).toEqual(["mdprv-simple-diffs"]);
  });
});

describe("settings preview height stability", () => {
  const charts = ui("islands/settings/previews/charts.ts");
  const settingsCss = ui("styles/settings.css");
  const baseCss = ui("styles/base.css");
  const mermaidCss = ui("styles/mermaid.css");
  const code = ui("islands/settings/previews/code.ts");
  const modal = ui("islands/settings/modal.ts");

  it("gives every chart example the same viewBox", () => {
    expect(charts).toContain('export const CHART_VIEWBOX = "0 0 300 260"');
    const shared = charts.split(
      'class="mdprv-settings-chart-svg" viewBox="${CHART_VIEWBOX}"'
    );
    expect(shared.length - 1).toBe(3);
    expect(charts).not.toMatch(/mdprv-settings-chart-svg" viewBox="0 0 300 2[57]0"/);
  });

  it("pins the SVG ratio and the card floor in CSS", () => {
    const svg = settingsCss.split(".mdprv-settings-chart-svg{")[1]?.split("}")[0] ?? "";
    expect(svg).toContain("aspect-ratio:300/260");
    const card = settingsCss.split(".mdprv-settings-chart-card{")[1]?.split("}")[0] ?? "";
    expect(card).toContain("min-height:180px");
  });

  it("reserves the code card height and keeps the previous HTML on failure", () => {
    const host = settingsCss.split(".mdprv-settings-code-host{")[1]?.split("}")[0] ?? "";
    expect(host).toContain("min-height:");
    expect(code).toContain("const PREVIEW_CACHE = new Map<string, CodePreview>()");
    expect(code).toContain("const cached = PREVIEW_CACHE.get(theme)");
    expect(code).not.toContain('host.textContent = ""');
  });

  it("keeps the Mermaid fence from collapsing before the SVG arrives", () => {
    expect(mermaidCss).toContain("pre.mermaid:not(:has(> svg)){min-height:");
  });

  it("compensates the removed page scrollbar when the modal locks scroll", () => {
    expect(baseCss).toContain(
      "html{padding-right:var(--mdprv-scrollbar-gutter,0px)}"
    );
    expect(modal).toContain('"--mdprv-scrollbar-gutter"');
    expect(modal).toContain("lockScroll()");
    expect(modal).toContain("unlockScroll()");
    const scroll = settingsCss.split(".mdprv-settings-scroll{")[1]?.split("}")[0] ?? "";
    expect(scroll).toContain("scrollbar-gutter:stable");
  });

  it("sizes emoji glyphs with CSS only", () => {
    expect(baseCss).toContain(
      ".mdprv-emoji{width:1em;height:1em;display:inline-block;vertical-align:-0.12em}"
    );
  });

  it("keeps the save button in the flow while it is hidden", () => {
    expect(modal).not.toContain("saveButton.hidden");
    expect(modal).toContain('saveButton.classList.toggle("is-hidden", !dirty)');
    const hidden = settingsCss.split(".mdprv-settings-save.is-hidden{")[1]?.split("}")[0] ?? "";
    expect(hidden).toContain("visibility:hidden");
    expect(hidden).toContain("pointer-events:none");
    expect(settingsCss).not.toContain(".mdprv-settings-save[hidden]{display:none}");
  });

  it("reserves one line for the import status and error", () => {
    const message =
      settingsCss.split(".mdprv-settings-import-message{")[1]?.split("}")[0] ?? "";
    expect(message).toContain("min-height:");
    expect(settingsCss).toContain(".mdprv-settings-import-status{");
  });
});
