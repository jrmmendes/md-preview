/**
 * Progressive enhancement for server-rendered ```diff fences.
 *
 * Both views already exist in the markup (the split pane starts hidden), so the
 * block is fully readable without JavaScript. This island only wires the
 * per-block toolbar and remembers the last choice globally in localStorage.
 */

import { getDiffView, setDiffView, type DiffView } from "../prefs";

const BLOCK_SELECTOR = "[data-diff-view]";
const BUTTON_SELECTOR = "[data-diff-view-target]";
const PANE_SELECTOR = "[data-diff-pane]";

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

function setup(block: HTMLElement): void {
  if (block.dataset.mdprvDiffReady === "1") {
    return;
  }
  block.dataset.mdprvDiffReady = "1";

  block.addEventListener("click", (event) => {
    const target = event.target;
    const button =
      target instanceof Element
        ? target.closest<HTMLElement>(BUTTON_SELECTOR)
        : null;
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
