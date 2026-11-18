/**
 * Dependency-free SVG charts for the table island.
 *
 * The renderer receives the already-filtered/sorted chart model from
 * `src/shared/table.ts` and produces a single `<svg role="img">` with axes,
 * readable labels, per-mark tooltips (hover and focus) and a textual summary
 * for assistive technology. Colors are CSS variables emitted by the active
 * theme (`--mdprv-chart-1..12`) with a built-in fallback, so light/dark and
 * automatic themes recolor without re-rendering.
 */

import {
  DEFAULT_CHART_PALETTE_LIGHT,
  type ChartData,
  type ChartKind,
} from "../../shared/table";

export const CHART_KIND_LABELS: Record<ChartKind, string> = {
  bar: "Barras verticais",
  hbar: "Barras horizontais",
  line: "Linha",
  area: "Área",
  pie: "Pizza/rosca",
  scatter: "Dispersão",
};

/** Mini previews shown next to each option in the chart popover. */
export const CHART_PREVIEWS: Record<ChartKind, string> = {
  bar: '<svg viewBox="0 0 28 20" aria-hidden="true"><rect x="3" y="9" width="4" height="8"></rect><rect x="10" y="3" width="4" height="14"></rect><rect x="17" y="6" width="4" height="11"></rect><rect x="24" y="11" width="2" height="6"></rect></svg>',
  hbar: '<svg viewBox="0 0 28 20" aria-hidden="true"><rect x="2" y="3" width="18" height="3"></rect><rect x="2" y="9" width="23" height="3"></rect><rect x="2" y="15" width="13" height="3"></rect></svg>',
  line: '<svg viewBox="0 0 28 20" aria-hidden="true"><polyline points="2,16 8,10 14,13 20,5 26,8"></polyline><circle cx="8" cy="10" r="1.6"></circle><circle cx="20" cy="5" r="1.6"></circle></svg>',
  area: '<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M2 16 8 10 14 13 20 5 26 8V18H2Z" class="mdprv-chart-preview-fill"></path><polyline points="2,16 8,10 14,13 20,5 26,8"></polyline></svg>',
  pie: '<svg viewBox="0 0 28 20" aria-hidden="true"><path d="M14 10V2a8 8 0 0 1 7 4Z"></path><path d="M14 10 21 6a8 8 0 0 1-7 12Z" class="mdprv-chart-preview-fill"></path><circle cx="14" cy="10" r="8"></circle><circle cx="14" cy="10" r="3.4" class="mdprv-chart-preview-hole"></circle></svg>',
  scatter: '<svg viewBox="0 0 28 20" aria-hidden="true"><circle cx="4" cy="15" r="1.6"></circle><circle cx="9" cy="11" r="1.6"></circle><circle cx="13" cy="13" r="1.6"></circle><circle cx="18" cy="6" r="1.6"></circle><circle cx="24" cy="9" r="1.6"></circle></svg>',
};

const SVG_NS = "http://www.w3.org/2000/svg";
const FORMATTER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/** Palette as CSS variables so a theme/color-scheme change recolors in place. */
export function chartPaletteTokens(count = 8): string[] {
  return Array.from({ length: count }, (_, index) => {
    const fallback = DEFAULT_CHART_PALETTE_LIGHT[index % DEFAULT_CHART_PALETTE_LIGHT.length]!;
    return `var(--mdprv-chart-${index + 1}, ${fallback})`;
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatNumber(value: number): string {
  return FORMATTER.format(value);
}

function truncate(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function numericValues(data: ChartData): number[] {
  return data.series.flatMap((series) =>
    series.values.filter((value): value is number => value !== null)
  );
}

/** Short `aria-label` describing the chart contents. */
export function chartAriaLabel(kind: ChartKind, data: ChartData): string {
  const values = numericValues(data);
  const label = CHART_KIND_LABELS[kind].toLowerCase();
  if (values.length === 0) {
    return `Gráfico de ${label} sem valores numéricos.`;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  return `Gráfico de ${label}: ${data.valueLabel} por ${data.categoryLabel}, ${values.length} ${
    values.length === 1 ? "valor" : "valores"
  }, de ${formatNumber(min)} a ${formatNumber(max)}.`;
}

interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / power;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * power;
}

function buildScale(values: number[], includeZero = true): Scale {
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1, ticks: [0, 1] };
  }
  if (min === max) {
    max = min + 1;
  }
  const step = niceStep((max - min) / 5);
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) {
    ticks.push(Math.round(value * 1e9) / 1e9);
  }
  return { min: start, max: end, ticks };
}

function arcPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number
): string {
  const large = end - start > Math.PI ? 1 : 0;
  const x1 = cx + outer * Math.cos(start);
  const y1 = cy + outer * Math.sin(start);
  const x2 = cx + outer * Math.cos(end);
  const y2 = cy + outer * Math.sin(end);
  const x3 = cx + inner * Math.cos(end);
  const y3 = cy + inner * Math.sin(end);
  const x4 = cx + inner * Math.cos(start);
  const y4 = cy + inner * Math.sin(start);
  return [
    `M${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A${outer} ${outer} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A${inner} ${inner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    "Z",
  ].join(" ");
}

function markAttributes(
  category: string,
  value: number,
  focusable: boolean
): string {
  const tip = `${category}: ${formatNumber(value)}`;
  const label = escapeXml(tip);
  return (
    ` data-tip="${label}" aria-label="${label}"` +
    (focusable ? ' tabindex="0" focusable="true"' : "")
  );
}

function showChartTip(container: HTMLElement, target: Element): void {
  const tip = container.querySelector<HTMLElement>(".mdprv-chart-tip");
  const text = target.getAttribute("data-tip");
  if (!tip || !text) {
    return;
  }
  const rect = target.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = `${Math.round(rect.left - box.left + rect.width / 2)}px`;
  tip.style.top = `${Math.round(rect.top - box.top - 6)}px`;
}

function hideChartTip(container: HTMLElement): void {
  const tip = container.querySelector<HTMLElement>(".mdprv-chart-tip");
  if (tip) {
    tip.hidden = true;
  }
}

/**
 * Render `data` inside `container`, replacing any previous chart. The
 * container is expected to be `.mdprv-table-chart` (position: relative).
 */
export function renderChart(
  container: HTMLElement,
  kind: ChartKind,
  data: ChartData,
  palette: string[] = chartPaletteTokens()
): void {
  container.replaceChildren();
  const values = numericValues(data);
  const title = document.createElement("p");
  title.className = "mdprv-chart-title";
  title.textContent = `${data.valueLabel} por ${data.categoryLabel}`;
  container.append(title);

  if (values.length === 0) {
    const empty = document.createElement("p");
    empty.className = "mdprv-chart-empty";
    empty.textContent = "A coluna escolhida não tem valores numéricos.";
    container.append(empty);
    return;
  }

  const scroll = document.createElement("div");
  scroll.className = "mdprv-chart-scroll";
  const svg = document.createElementNS(SVG_NS, "svg");
  const focusable = data.categories.length <= 40;

  const colorAt = (index: number): string => palette[index % palette.length] ?? "";
  const seriesColor = colorAt(0);

  // Fit the current container instead of forcing a horizontal scrollbar on
  // every table; very wide category sets still grow and scroll.
  const available = Math.max(320, (container.clientWidth || 720) - 28);
  const width = Math.max(
    available,
    Math.min(
      3600,
      data.categories.length * (kind === "hbar" ? 0 : kind === "bar" ? 46 : 34)
    )
  );
  const height = 360;
  const margin =
    kind === "hbar"
      ? { top: 20, right: 28, bottom: 34, left: 132 }
      : {
          top: 22,
          right: kind === "bar" ? 22 : 40,
          bottom: 78,
          left: 64,
        };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const scale = buildScale(values);

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", chartAriaLabel(kind, data));
  svg.classList.add("mdprv-chart-svg");

  const titleEl = document.createElementNS(SVG_NS, "title");
  titleEl.textContent = chartAriaLabel(kind, data);
  svg.append(titleEl);

  const parts: string[] = [];
  const yOf = (value: number): number =>
    margin.top + plotHeight - ((value - scale.min) / (scale.max - scale.min)) * plotHeight;
  const xOfValue = (value: number): number =>
    margin.left + ((value - scale.min) / (scale.max - scale.min)) * plotWidth;
  const y0 = yOf(0);
  const x0 = xOfValue(0);

  if (kind !== "pie" && kind === "hbar") {
    for (const tick of scale.ticks) {
      const x = xOfValue(tick);
      parts.push(
        `<line x1="${x.toFixed(2)}" y1="${margin.top}" x2="${x.toFixed(2)}" y2="${(margin.top + plotHeight).toFixed(2)}" stroke="var(--mdprv-border, #888)" stroke-opacity=".45"></line>` +
          `<text x="${x.toFixed(2)}" y="${(margin.top + plotHeight + 18).toFixed(2)}" text-anchor="middle" fill="var(--mdprv-muted, #777)" font-size="11">${escapeXml(formatNumber(tick))}</text>`
      );
    }
  } else if (kind !== "pie") {
    for (const tick of scale.ticks) {
      const y = yOf(tick);
      parts.push(
        `<line x1="${margin.left}" y1="${y.toFixed(2)}" x2="${margin.left + plotWidth}" y2="${y.toFixed(2)}" stroke="var(--mdprv-border, #888)" stroke-opacity=".45"></line>` +
          `<text x="${margin.left - 8}" y="${(y + 4).toFixed(2)}" text-anchor="end" fill="var(--mdprv-muted, #777)" font-size="11">${escapeXml(formatNumber(tick))}</text>`
      );
    }
  }

  if (kind === "bar") {
    const band = plotWidth / data.categories.length;
    const barWidth = Math.max(4, Math.min(44, band * 0.62));
    data.series[0]!.values.forEach((value, index) => {
      const x = margin.left + band * index + (band - barWidth) / 2;
      const category = data.categories[index] ?? "";
      if (value === null) {
        parts.push(
          `<rect x="${x.toFixed(2)}" y="${(y0 - 3).toFixed(2)}" width="${barWidth.toFixed(2)}" height="3" fill="var(--mdprv-border, #888)" opacity=".35"></rect>`
        );
        return;
      }
      const y = yOf(value);
      const top = Math.min(y, y0);
      const barHeight = Math.max(1, Math.abs(y0 - y));
      parts.push(
        `<rect x="${x.toFixed(2)}" y="${top.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="3" fill="${colorAt(index)}"${markAttributes(category, value, focusable)}></rect>`
      );
    });
  } else if (kind === "hbar") {
    const band = plotHeight / data.categories.length;
    const barHeight = Math.max(4, Math.min(30, band * 0.62));
    data.series[0]!.values.forEach((value, index) => {
      const y = margin.top + band * index + (band - barHeight) / 2;
      const category = data.categories[index] ?? "";
      parts.push(
        `<text x="${margin.left - 10}" y="${(y + barHeight / 2 + 4).toFixed(2)}" text-anchor="end" fill="var(--mdprv-fg, #222)" font-size="11">${escapeXml(truncate(category, 18))}</text>`
      );
      if (value === null) {
        parts.push(
          `<rect x="${(margin.left + 2).toFixed(2)}" y="${y.toFixed(2)}" width="3" height="${barHeight.toFixed(2)}" fill="var(--mdprv-border, #888)" opacity=".35"></rect>`
        );
        return;
      }
      const x = xOfValue(value);
      const left = Math.min(x, x0);
      const barWidth = Math.max(1, Math.abs(x - x0));
      parts.push(
        `<rect x="${left.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="3" fill="${colorAt(index)}"${markAttributes(category, value, focusable)}></rect>`
      );
    });
  } else if (kind === "line" || kind === "area" || kind === "scatter") {
    const count = data.categories.length;
    const xOf = (index: number): number =>
      count <= 1
        ? margin.left + plotWidth / 2
        : margin.left + (plotWidth * index) / (count - 1);
    const points = data.series[0]!.values.map((value, index) =>
      value === null ? null : { x: xOf(index), y: yOf(value), value, category: data.categories[index] ?? "" }
    );
    let segment: Array<{ x: number; y: number }> = [];
    const flush = (): void => {
      if (segment.length === 0) {
        return;
      }
      if (kind === "area" && segment.length > 1) {
        const first = segment[0]!;
        const last = segment[segment.length - 1]!;
        const polygon = [
          `M${first.x.toFixed(2)} ${y0.toFixed(2)}`,
          ...segment.map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
          `L${last.x.toFixed(2)} ${y0.toFixed(2)}`,
          "Z",
        ].join(" ");
        parts.push(`<path d="${polygon}" fill="${seriesColor}" fill-opacity=".22"></path>`);
      }
      if (kind !== "scatter") {
        parts.push(
          `<polyline points="${segment.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ")}" fill="none" stroke="${seriesColor}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></polyline>`
        );
      }
      segment = [];
    };

    for (const point of points) {
      if (!point) {
        flush();
        continue;
      }
      segment.push({ x: point.x, y: point.y });
    }
    flush();

    for (const point of points) {
      if (!point) {
        continue;
      }
      parts.push(
        `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${kind === "scatter" ? 5 : 4}" fill="${kind === "scatter" ? colorAt(points.indexOf(point)) : seriesColor}" stroke="var(--mdprv-bg, #fff)" stroke-width="1.5"${markAttributes(point.category, point.value, focusable)}></circle>`
      );
    }

    const labelEvery = Math.max(1, Math.ceil(count / 14));
    data.categories.forEach((category, index) => {
      if (index % labelEvery !== 0 && index !== count - 1) {
        return;
      }
      const x = xOf(index);
      const anchor =
        count > 6 ? "end" : index === 0 ? "start" : index === count - 1 ? "end" : "middle";
      parts.push(
        `<text x="${x.toFixed(2)}" y="${(margin.top + plotHeight + 18).toFixed(2)}" text-anchor="${anchor}" fill="var(--mdprv-muted, #777)" font-size="11"${count > 6 ? ` transform="rotate(-35 ${x.toFixed(2)} ${(margin.top + plotHeight + 18).toFixed(2)})"` : ""}>${escapeXml(truncate(category, 16))}</text>`
      );
    });
  } else if (kind === "pie") {
    const positive = data.series[0]!.values.map((value, index) => ({
      value: value !== null && value > 0 ? value : 0,
      index,
    }));
    const total = positive.reduce((sum, item) => sum + item.value, 0);
    const cx = width / 2;
    const cy = margin.top + plotHeight / 2;
    const outer = Math.max(40, Math.min(plotWidth, plotHeight) / 2 - 8);
    const inner = outer * 0.55;
    let angle = -Math.PI / 2;
    for (const item of positive) {
      if (item.value <= 0) {
        continue;
      }
      const end = angle + (item.value / total) * Math.PI * 2;
      const category = data.categories[item.index] ?? "";
      parts.push(
        `<path d="${arcPath(cx, cy, outer, inner, angle, end)}" fill="${colorAt(item.index)}" stroke="var(--mdprv-bg, #fff)" stroke-width="1.5"${markAttributes(category, item.value, focusable)}></path>`
      );
      angle = end;
    }
    parts.push(
      `<text x="${cx.toFixed(2)}" y="${(cy - 2).toFixed(2)}" text-anchor="middle" fill="var(--mdprv-fg, #222)" font-size="13" font-weight="600">${escapeXml(formatNumber(total))}</text>` +
        `<text x="${cx.toFixed(2)}" y="${(cy + 16).toFixed(2)}" text-anchor="middle" fill="var(--mdprv-muted, #777)" font-size="11">${escapeXml(data.valueLabel)}</text>`
    );
  }

  if (kind === "bar") {
    const band = plotWidth / data.categories.length;
    data.categories.forEach((category, index) => {
      const x = margin.left + band * index + band / 2;
      parts.push(
        `<text x="${x.toFixed(2)}" y="${(margin.top + plotHeight + 18).toFixed(2)}" text-anchor="end" fill="var(--mdprv-muted, #777)" font-size="11" transform="rotate(-35 ${x.toFixed(2)} ${(margin.top + plotHeight + 18).toFixed(2)})">${escapeXml(truncate(category, 16))}</text>`
      );
    });
  }

  svg.innerHTML = parts.join("");
  svg.prepend(titleEl);
  scroll.append(svg);
  container.append(scroll);

  const usesLegend = kind === "pie" || data.series.length > 1;
  if (usesLegend) {
    const legend = document.createElement("ul");
    legend.className = "mdprv-chart-legend";
    const entries =
      kind === "pie"
        ? data.categories.map((category, index) => ({ label: category, color: colorAt(index) }))
        : [{ label: data.series[0]!.name, color: seriesColor }];
    for (const entry of entries) {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "mdprv-chart-swatch";
      swatch.style.background = entry.color;
      swatch.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = truncate(entry.label, 28);
      item.append(swatch, label);
      legend.append(item);
    }
    container.append(legend);
  }

  const tip = document.createElement("div");
  tip.className = "mdprv-chart-tip";
  tip.hidden = true;
  container.append(tip);

  // Bind delegation once per container: handlers always query the current
  // tooltip element, so re-rendering does not stack listeners or leak nodes.
  if (container.dataset.mdprvChartBound !== "1") {
    container.dataset.mdprvChartBound = "1";
    container.addEventListener("pointerover", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-tip]")) {
        showChartTip(container, target.closest("[data-tip]")!);
      }
    });
    container.addEventListener("pointerout", (event) => {
      const target = event.target;
      const related = event.relatedTarget;
      if (target instanceof Element && target.closest("[data-tip]")) {
        if (!(related instanceof Element) || !related.closest("[data-tip]")) {
          hideChartTip(container);
        }
      }
    });
    container.addEventListener("focusin", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-tip]")) {
        showChartTip(container, target.closest("[data-tip]")!);
      }
    });
    container.addEventListener("focusout", () => hideChartTip(container));
  }
}
