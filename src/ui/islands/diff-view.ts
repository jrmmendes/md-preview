/**
 * Progressive enhancement for server-rendered ```diff fences.
 *
 * Both views already exist in the markup (the split pane starts hidden), so the
 * block is fully readable without JavaScript. This island wires the
 * per-block toolbar, remembers the last choice globally in localStorage and
 * copies the inline pane as a simplified patch.
 */

import {
  buildDiffClipboardText,
  type DiffTextKind,
  type DiffTextLine,
} from "../../shared/diff-text";
import { getDiffView, setDiffView, type DiffView } from "../prefs";
import { copyWithFeedback } from "./clipboard";

const BLOCK_SELECTOR = "[data-diff-view]";
const BUTTON_SELECTOR = "[data-diff-view-target]";
const PANE_SELECTOR = "[data-diff-pane]";
const COPY_SELECTOR = "[data-diff-copy]";
const INLINE_PANE_SELECTOR = '[data-diff-pane="inline"]';
const ROW_SELECTOR = "tr.mdprv-diff-row";
const CODE_CELL_SELECTOR = "td.mdprv-diff-code";

function normalizeView(value: string | undefined): DiffView {
  return value === "split" ? "split" : "inline";
}

function applyView(block: HTMLElement, view: DiffView): void {
  block.dataset.diffView = view;

  block.querySelectorAll<HTMLButtonElement>(BUTTON_SELECTOR).forEach((button) => {
    const target = normalizeView(button.dataset.diffViewTarget);
    button.setAttribute("aria-pressed", target === view ? "true" : "false");
  });

  block.querySelectorAll<HTMLElement>(PANE_SELECTOR).forEach((pane) => {
    const paneView = normalizeView(pane.dataset.diffPane);
    pane.hidden = paneView !== view;
  });
}

function applyAll(view: DiffView): void {
  document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR).forEach((block) => {
    applyView(block, view);
  });
}

/**
 * Read the inline pane, the canonical source, so the clipboard text does not
 * depend on which view is active. Rows without a code cell (hunk/meta) are
 * dropped by the builder.
 */
function readInlineLines(block: HTMLElement): DiffTextLine[] {
  const pane = block.querySelector<HTMLElement>(INLINE_PANE_SELECTOR);
  if (!pane) {
    return [];
  }

  const lines: DiffTextLine[] = [];
  pane.querySelectorAll<HTMLTableRowElement>(ROW_SELECTOR).forEach((row) => {
    const code = row.querySelector<HTMLElement>(CODE_CELL_SELECTOR);
    if (!code) {
      return;
    }
    lines.push({
      kind: (row.dataset.diffKind ?? "context") as DiffTextKind,
      text: code.textContent ?? "",
    });
  });
  return lines;
}

function setup(block: HTMLElement): void {
  if (block.dataset.mdprvDiffReady === "1") {
    return;
  }
  block.dataset.mdprvDiffReady = "1";

  block.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const copyButton = target.closest<HTMLElement>(COPY_SELECTOR);
    if (copyButton && block.contains(copyButton)) {
      const text = buildDiffClipboardText(readInlineLines(block));
      if (text) {
        copyWithFeedback(copyButton, () => text);
      }
      return;
    }

    const button = target.closest<HTMLElement>(BUTTON_SELECTOR);
    if (!button || !block.contains(button)) {
      return;
    }
    const view = normalizeView(button.dataset.diffViewTarget);
    setDiffView(view);
    applyAll(view);
  });
}

export function initDiffView(): void {
  function run(): void {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(BLOCK_SELECTOR));
    blocks.forEach(setup);

    // Everything follows the persisted (or default) preference on load.
    const view = getDiffView();
    for (const block of blocks) {
      applyView(block, view);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
