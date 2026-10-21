function metaValueHtml(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const text =
          typeof item === "object" && item !== null ? JSON.stringify(item) : String(item);
        return `<span class="mdprv-tag">${Bun.escapeHTML(text)}</span>`;
      })
      .join(" ");
  }
  if (typeof value === "object") {
    return `<code>${Bun.escapeHTML(JSON.stringify(value))}</code>`;
  }
  return Bun.escapeHTML(String(value));
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function renderMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) {
    return "";
  }
  const keys = Object.keys(meta);
  if (keys.length === 0) {
    return "";
  }
  const summary = hasValue(meta.date)
    ? String(meta.date)
    : hasValue(meta.title)
      ? String(meta.title)
      : "Metadata";
  const rows = keys
    .map((key) => `<dt>${Bun.escapeHTML(key)}</dt><dd>${metaValueHtml(meta[key])}</dd>`)
    .join("");
  return `<details class="mdprv-meta-card"><summary>${Bun.escapeHTML(summary)}</summary><dl>${rows}</dl></details>`;
}
