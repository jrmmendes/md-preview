/**
 * Preview-scoped Widgets classes.
 *
 * The real document reflects these flags only after Save (`html.mdprv-*`).
 * While the modal is open the same classes go on the preview wrapper, so the
 * preview reacts live without touching the page behind it. Kept DOM-free so
 * the mapping can be tested with `bun test`.
 */
export type WidgetPreviewTarget = "tables" | "diffs";

export interface WidgetPreviewState {
  simpleTables: boolean;
  simpleDiffs: boolean;
  tableWrap: boolean;
}

export const WIDGET_PREVIEW_CLASSES = [
  "mdprv-simple-tables",
  "mdprv-simple-diffs",
  "mdprv-wrap-cells",
] as const;

export function widgetPreviewClasses(
  target: WidgetPreviewTarget,
  state: WidgetPreviewState
): string[] {
  if (target === "diffs") {
    return state.simpleDiffs ? ["mdprv-simple-diffs"] : [];
  }
  const classes: string[] = [];
  if (state.simpleTables) {
    classes.push("mdprv-simple-tables");
  }
  if (state.tableWrap) {
    classes.push("mdprv-wrap-cells");
  }
  return classes;
}
