/**
 * Progressive enhancement for server-rendered ```tree fences.
 *
 * The markup already contains native <details>/<summary> elements, so the tree
 * is usable without JavaScript. This island only adds the global toolbar,
 * keeps aria-expanded in sync and implements the conventional arrow-key
 * navigation between visible rows.
 */

const TREE_SELECTOR = "[data-mdprv-tree]";
const SUMMARY_SELECTOR = "summary.mdprv-tree-row";
const DETAILS_SELECTOR = "details.mdprv-tree-dir";

function directSummary(details: HTMLDetailsElement): HTMLElement | null {
  const first = details.firstElementChild;
  return first instanceof HTMLElement && first.tagName === "SUMMARY" ? first : null;
}

function firstChildSummary(details: HTMLDetailsElement): HTMLElement | null {
  const group = details.querySelector<HTMLElement>(".mdprv-tree-group");
  const nested = group?.querySelector<HTMLDetailsElement>(DETAILS_SELECTOR);
  return nested ? directSummary(nested) : null;
}

function parentSummary(details: HTMLDetailsElement): HTMLElement | null {
  const parent = details.parentElement?.closest("details");
  return parent ? directSummary(parent) : null;
}

function isVisible(summary: HTMLElement): boolean {
  const own = summary.closest("details");
  let parent = own?.parentElement?.closest("details") ?? null;
  while (parent) {
    if (!parent.open) {
      return false;
    }
    parent = parent.parentElement?.closest("details") ?? null;
  }
  return true;
}

function sync(details: HTMLDetailsElement): void {
  const summary = directSummary(details);
  if (summary) {
    summary.setAttribute("aria-expanded", details.open ? "true" : "false");
  }
}

function visibleSummaries(tree: HTMLElement): HTMLElement[] {
  return Array.from(tree.querySelectorAll<HTMLElement>(SUMMARY_SELECTOR)).filter(isVisible);
}

function setup(tree: HTMLElement): void {
  if (tree.dataset.mdprvTreeReady === "1") {
    return;
  }
  tree.dataset.mdprvTreeReady = "1";

  const details = Array.from(tree.querySelectorAll<HTMLDetailsElement>(DETAILS_SELECTOR));
  for (const item of details) {
    sync(item);
    item.addEventListener("toggle", () => sync(item));
  }

  const toolbar = tree.querySelector<HTMLElement>("[data-mdprv-tree-toolbar]");
  if (toolbar) {
    toolbar.hidden = false;
  }

  const setAll = (open: boolean): void => {
    for (const item of details) {
      item.open = open;
      sync(item);
    }
  };

  tree
    .querySelector<HTMLElement>('[data-mdprv-tree-action="expand"]')
    ?.addEventListener("click", () => setAll(true));
  tree
    .querySelector<HTMLElement>('[data-mdprv-tree-action="collapse"]')
    ?.addEventListener("click", () => setAll(false));

  tree.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const target = event.target;
    const summary = target instanceof Element ? target.closest<HTMLElement>(SUMMARY_SELECTOR) : null;
    if (!summary) {
      return;
    }
    const detailsElement = summary.closest<HTMLDetailsElement>(DETAILS_SELECTOR);
    if (!detailsElement) {
      return;
    }

    switch (event.key) {
      case "ArrowRight": {
        if (!detailsElement.open) {
          event.preventDefault();
          detailsElement.open = true;
          sync(detailsElement);
          return;
        }
        const child = firstChildSummary(detailsElement);
        if (child) {
          event.preventDefault();
          child.focus();
        }
        return;
      }
      case "ArrowLeft": {
        if (detailsElement.open) {
          event.preventDefault();
          detailsElement.open = false;
          sync(detailsElement);
          return;
        }
        const parent = parentSummary(detailsElement);
        if (parent) {
          event.preventDefault();
          parent.focus();
        }
        return;
      }
      case "ArrowDown":
      case "ArrowUp": {
        const rows = visibleSummaries(tree);
        const index = rows.indexOf(summary);
        if (index < 0) {
          return;
        }
        const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          event.preventDefault();
          next.focus();
        }
        return;
      }
      case "Home":
      case "End": {
        const rows = visibleSummaries(tree);
        if (rows.length === 0) {
          return;
        }
        event.preventDefault();
        rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
        return;
      }
      default:
        return;
    }
  });
}

export function initTree(): void {
  function run(): void {
    document.querySelectorAll<HTMLElement>(TREE_SELECTOR).forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
