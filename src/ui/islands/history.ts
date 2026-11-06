import type { SlugInfo } from "../../core/contract";
import { on } from "../services/events";
import { announce, showNoDocumentOpen } from "./empty-state";

function isSlugInfo(value: unknown): value is SlugInfo {
  return typeof value === "object" && value !== null && typeof (value as SlugInfo).slug === "string";
}

/** Encode each path segment so nested slugs keep their slashes. */
function encodeSlug(slug: string): string {
  return slug.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function displayTitle(item: SlugInfo): string {
  const title = typeof item.title === "string" ? item.title : "";
  if (title) {
    return title;
  }
  const path = typeof item.path === "string" ? item.path : "";
  const base = path.split("/").filter(Boolean).pop();
  return base || item.slug;
}

export function initHistory(): void {
  const listElement = document.getElementById("mdprv-history-list");
  if (!listElement) {
    return;
  }
  const list = listElement;

  let current = location.pathname.slice(1);
  try {
    current = decodeURIComponent(current);
  } catch {
    /* keep the raw path */
  }

  let items: SlugInfo[] = [];
  let pendingFocus: string | null = null;

  function focusPending(): void {
    if (pendingFocus === null) {
      return;
    }
    const slug = pendingFocus;
    pendingFocus = null;
    const entry = Array.from(list.children).find(
      (child) => child.getAttribute("data-slug") === slug
    );
    const button = entry?.querySelector<HTMLButtonElement>(".mdprv-history-close");
    button?.focus();
  }

  async function closeDocument(item: SlugInfo, entry: HTMLElement, button: HTMLButtonElement): Promise<void> {
    const siblings = Array.from(list.children) as HTMLElement[];
    const index = siblings.indexOf(entry);
    const neighbour = siblings[index + 1] ?? siblings[index - 1] ?? null;
    const nextSlug = neighbour?.getAttribute("data-slug") ?? null;
    const wasCurrent = item.slug === current;

    button.disabled = true;
    try {
      const response = await fetch(`/__doc/${encodeSlug(item.slug)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (response.status !== 204 && response.status !== 404) {
        throw new Error(`close failed with status ${response.status}`);
      }
    } catch {
      button.disabled = false;
      announce("Could not close document");
      return;
    }

    items = items.filter((candidate) => candidate.slug !== item.slug);
    if (wasCurrent || items.length === 0) {
      render(items);
      showNoDocumentOpen();
      return;
    }

    pendingFocus = nextSlug ?? items[0]!.slug;
    render(items);
    announce("Document closed");
  }

  function makeItem(item: SlugInfo): HTMLLIElement {
    const entry = document.createElement("li");
    entry.className = "mdprv-history-item";
    entry.setAttribute("data-slug", item.slug);

    const anchor = document.createElement("a");
    anchor.href = "/" + encodeSlug(item.slug);
    const title = displayTitle(item);
    const path = typeof item.path === "string" ? item.path : "";
    anchor.textContent = title;
    anchor.title = path || item.slug;
    if (item.slug === current) {
      anchor.className = "active";
    }
    entry.appendChild(anchor);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "mdprv-history-close";
    close.setAttribute("aria-label", `Close ${title}`);
    close.title = `Close ${title} (remove from Recent and stop watching; the file stays on disk)`;
    const glyph = document.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "×";
    close.appendChild(glyph);
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void closeDocument(item, entry, close);
    });
    entry.appendChild(close);

    return entry;
  }

  function render(next: SlugInfo[]): void {
    const active = document.activeElement;
    const focusedEntry =
      active instanceof HTMLElement && list.contains(active)
        ? active.closest<HTMLElement>("[data-slug]")
        : null;
    const focusedSlug = focusedEntry?.getAttribute("data-slug") ?? null;
    const focusedClose = active instanceof HTMLElement && active.classList.contains("mdprv-history-close");

    items = next.filter(isSlugInfo).filter((item) => item.slug !== "");
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.appendChild(makeItem(item));
    }
    list.textContent = "";
    list.appendChild(fragment);

    if (pendingFocus !== null) {
      focusPending();
      return;
    }
    if (focusedSlug !== null) {
      const entry = Array.from(list.children).find(
        (child) => child.getAttribute("data-slug") === focusedSlug
      );
      const target = focusedClose
        ? entry?.querySelector<HTMLElement>(".mdprv-history-close")
        : entry?.querySelector<HTMLElement>("a");
      target?.focus();
    }
  }

  on("snapshot", (data) => {
    render(data.slugs);
  });

  on("slugs", (data) => {
    render(data);
  });
}
