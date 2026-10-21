import type { SlugInfo } from "../../core/contract";
import { on } from "../services/events";

function isSlugInfo(value: unknown): value is SlugInfo {
  return typeof value === "object" && value !== null && typeof (value as SlugInfo).slug === "string";
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

  function makeItem(item: SlugInfo): HTMLLIElement {
    const entry = document.createElement("li");
    const anchor = document.createElement("a");
    anchor.href = "/" + encodeURIComponent(item.slug);
    let title = typeof item.title === "string" ? item.title : "";
    const path = typeof item.path === "string" ? item.path : "";
    if (!title) {
      const base = path.split("/").filter(Boolean).pop();
      title = base || item.slug;
    }
    anchor.textContent = title;
    anchor.title = path || item.slug;
    if (item.slug === current) {
      anchor.className = "active";
    }
    entry.appendChild(anchor);
    return entry;
  }

  function render(items: SlugInfo[]): void {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      if (isSlugInfo(item) && item.slug) {
        fragment.appendChild(makeItem(item));
      }
    });
    list.textContent = "";
    list.appendChild(fragment);
  }

  on("snapshot", (data) => {
    render(data.slugs);
  });

  on("slugs", (data) => {
    render(data);
  });
}
