/**
 * Prévia do bloco Gráficos: SVGs locais (sem `mermaid.render`) coloridos pelo
 * tema Mermaid escolhido em cada card, um claro e um escuro.
 *
 * Temas embutidos usam a paleta fixa; temas importados expõem as `variables`
 * do arquivo e são pintados pelas chaves que o diagrama usa.
 */
import type { MermaidThemeEntry } from "../../../../core/contract";
import type {
  BuiltinMermaidThemeName,
  MermaidThemeName,
} from "../../../../core/themes/constants";
import { el, iconMenu } from "../components";

interface MermaidPalette {
  label: string;
  node: string;
  border: string;
  line: string;
  text: string;
  background?: string;
  font?: string;
}

const BUILTIN_PALETTES: Record<BuiltinMermaidThemeName, MermaidPalette> = {
  default: { label: "Default", node: "#ECECFF", border: "#9370DB", line: "#9370DB", text: "#333333" },
  neutral: { label: "Neutral", node: "#eeeeee", border: "#666666", line: "#666666", text: "#333333" },
  dark: { label: "Dark", node: "#1f2020", border: "#cccccc", line: "#cccccc", text: "#dddddd", background: "#1e1f22" },
  forest: { label: "Forest", node: "#cde498", border: "#13540c", line: "#13540c", text: "#1a1a1a" },
  base: { label: "Base", node: "#ECECFF", border: "#9370DB", line: "#9370DB", text: "#333333" },
};

const BUILTIN_ORDER: BuiltinMermaidThemeName[] = ["default", "neutral", "forest", "dark", "base"];

function stringVar(
  variables: Record<string, string>,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const value = variables[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value;
    }
  }
  return null;
}

export function paletteForEntry(entry: MermaidThemeEntry): MermaidPalette {
  if (entry.source !== "custom") {
    return (
      BUILTIN_PALETTES[entry.name as BuiltinMermaidThemeName] ??
      BUILTIN_PALETTES.default
    );
  }
  const variables = entry.variables;
  const node = stringVar(variables, "primaryColor", "mainBkg") ?? "#ECECFF";
  const line =
    stringVar(variables, "lineColor", "primaryBorderColor", "nodeBorder") ?? "#9370DB";
  return {
    label: entry.label,
    node,
    border: stringVar(variables, "nodeBorder", "primaryBorderColor", "lineColor") ?? line,
    line,
    text:
      stringVar(variables, "primaryTextColor", "textColor", "titleColor") ?? "#333333",
    background: stringVar(variables, "background") ?? undefined,
    font: stringVar(variables, "fontFamily", "font-family") ?? undefined,
  };
}

export function entryByName(
  themes: MermaidThemeEntry[],
  name: MermaidThemeName
): MermaidThemeEntry | undefined {
  return themes.find((entry) => entry.name === name);
}

let markerSequence = 0;

function marker(): { defs: string; id: string } {
  markerSequence += 1;
  const id = `mdprv-settings-chart-arrow-${markerSequence}`;
  const defs = `<defs>
      <marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path class="chart-arrow" d="M 0 0 L 10 5 L 0 10 z"></path>
      </marker>
    </defs>`;
  return { defs, id };
}

/** Every example shares one viewBox so the card keeps the same height. */
export const CHART_VIEWBOX = "0 0 300 260";

function flowSvg(arrow: { defs: string; id: string }): string {
  return `<svg class="mdprv-settings-chart-svg" viewBox="${CHART_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
      ${arrow.defs}
      <rect class="chart-node" x="95" y="12" width="110" height="32" rx="5"></rect>
      <text class="chart-title" x="150" y="29">Início</text>
      <path class="chart-edge" d="M 150 44 L 150 70" marker-end="url(#${arrow.id})"></path>
      <rect class="chart-node" x="95" y="72" width="110" height="32" rx="5"></rect>
      <text class="chart-title" x="150" y="89">Analisar</text>
      <path class="chart-edge" d="M 150 104 L 150 122" marker-end="url(#${arrow.id})"></path>
      <polygon class="chart-node" points="150,124 205,160 150,196 95,160"></polygon>
      <text class="chart-title" x="150" y="161">Válido?</text>
      <path class="chart-edge" d="M 100 170 C 80 186 66 198 64 214" marker-end="url(#${arrow.id})"></path>
      <text class="chart-label" x="96" y="202">sim</text>
      <rect class="chart-node" x="8" y="216" width="112" height="32" rx="5"></rect>
      <text class="chart-title" x="64" y="233">Renderizar</text>
    </svg>`;
}

function sequenceSvg(arrowId: string): string {
  const actor = (x: number, name: string): string => `
    <rect class="chart-node" x="${x - 40}" y="10" width="80" height="28" rx="5"></rect>
    <text class="chart-title" x="${x}" y="25">${name}</text>
    <path class="chart-life" d="M ${x} 38 L ${x} 252"></path>`;
  const message = (from: number, to: number, y: number, label: string): string => `
    <path class="chart-edge" d="M ${from} ${y} L ${to} ${y}" marker-end="url(#${arrowId})"></path>
    <text class="chart-label" x="${(from + to) / 2}" y="${y - 7}">${label}</text>`;
  return `<svg class="mdprv-settings-chart-svg" viewBox="${CHART_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="${arrowId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path class="chart-arrow" d="M 0 0 L 10 5 L 0 10 z"></path>
        </marker>
      </defs>
      ${actor(55, "Cliente")}
      ${actor(150, "Servidor")}
      ${actor(245, "Arquivo")}
      ${message(55, 150, 78, "GET /doc")}
      ${message(150, 245, 118, "ler arquivo")}
      ${message(245, 150, 158, "conteúdo")}
      ${message(150, 55, 198, "200 OK")}
    </svg>`;
}

function classesSvg(): string {
  return `<svg class="mdprv-settings-chart-svg" viewBox="${CHART_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
      <rect class="chart-node" x="15" y="30" width="125" height="110" rx="5"></rect>
      <path class="chart-edge chart-edge--plain" d="M 15 58 L 140 58"></path>
      <text class="chart-title" x="77" y="45">Documento</text>
      <text class="chart-field" x="27" y="78">titulo: string</text>
      <text class="chart-field" x="27" y="99">path: Path</text>
      <rect class="chart-node" x="160" y="110" width="125" height="110" rx="5"></rect>
      <path class="chart-edge chart-edge--plain" d="M 160 138 L 285 138"></path>
      <text class="chart-title" x="222" y="125">Tema</text>
      <text class="chart-field" x="172" y="158">nome: string</text>
      <text class="chart-field" x="172" y="179">cores: Map</text>
      <path class="chart-edge" d="M 140 85 L 160 150"></path>
      <text class="chart-label" x="146" y="92">1</text>
      <text class="chart-label" x="154" y="138">n</text>
    </svg>`;
}

interface ChartExample {
  id: string;
  label: string;
  render: () => string;
}

export const CHART_EXAMPLES: ChartExample[] = [
  {
    id: "fluxo",
    label: "Fluxo",
    render: () => flowSvg(marker()),
  },
  {
    id: "sequencia",
    label: "Sequência",
    render: () => {
      markerSequence += 1;
      return sequenceSvg(`mdprv-settings-chart-arrow-${markerSequence}`);
    },
  },
  { id: "classes", label: "Classes", render: classesSvg },
];

export const DEFAULT_CHART_EXAMPLE = "fluxo";

const MODES = [
  { id: "light" as const, label: "Claro" },
  { id: "dark" as const, label: "Escuro" },
];

export function chartExample(id: string): ChartExample {
  return CHART_EXAMPLES.find((example) => example.id === id) ?? CHART_EXAMPLES[0];
}

function applyPalette(card: HTMLElement, palette: MermaidPalette): void {
  card.style.removeProperty("--chart-surface");
  card.style.removeProperty("--chart-hairline");
  card.style.removeProperty("--chart-font");
  card.style.setProperty("--chart-node", palette.node);
  card.style.setProperty("--chart-border", palette.border);
  card.style.setProperty("--chart-line", palette.line);
  card.style.setProperty("--chart-text", palette.text);
  if (palette.background) {
    card.style.setProperty("--chart-surface", palette.background);
    card.style.setProperty("--chart-hairline", "color-mix(in srgb,#000 18%,transparent)");
  }
  if (palette.font) {
    card.style.setProperty("--chart-font", palette.font);
  }
}

export interface ChartsPreviewConfig {
  light: MermaidThemeName;
  dark: MermaidThemeName;
  exampleId: string;
  editable: boolean;
  themes: MermaidThemeEntry[];
  onChange: (face: "light" | "dark", theme: MermaidThemeName) => void;
}

interface CardEntry {
  mode: (typeof MODES)[number];
  card: HTMLElement;
  themeId: MermaidThemeName;
}

function optionLabel(entry: MermaidThemeEntry): string {
  return entry.source === "custom" ? `${entry.label} (importado)` : entry.label;
}

/** Builtins in display order, then imported themes alphabetically. */
function menuEntries(
  themes: MermaidThemeEntry[],
  current: MermaidThemeName
): MermaidThemeEntry[] {
  const result: MermaidThemeEntry[] = [];
  for (const name of BUILTIN_ORDER) {
    const entry = themes.find((item) => item.name === name);
    if (entry) {
      result.push(entry);
    } else {
      result.push({
        name,
        label: BUILTIN_PALETTES[name].label,
        source: "builtin",
        theme: name,
        variables: {},
      });
    }
  }
  const customs = themes
    .filter((entry) => entry.source === "custom")
    .sort((a, b) => a.label.localeCompare(b.label));
  result.push(...customs);
  if (!result.some((entry) => entry.name === current)) {
    result.unshift({
      name: current,
      label: current,
      source: "custom",
      theme: "base",
      variables: {},
    });
  }
  return result;
}

export interface ChartsPreviewHandle {
  root: HTMLElement;
  /** Repaints the cards for another example without rebuilding the form. */
  setExample(id: string): void;
}

export function renderChartsPreview(
  config: ChartsPreviewConfig
): ChartsPreviewHandle {
  let exampleId = config.exampleId;
  const cards: CardEntry[] = [];
  const grid = el("div", { class: "mdprv-settings-chart-grid" });

  const paint = (): void => {
    const example = chartExample(exampleId);
    for (const entry of cards) {
      entry.card.innerHTML = example.render();
      const themeEntry = entryByName(config.themes, entry.themeId);
      const palette = themeEntry
        ? paletteForEntry(themeEntry)
        : BUILTIN_PALETTES.default;
      applyPalette(entry.card, palette);
      const svg = entry.card.querySelector("svg");
      if (svg) {
        svg.setAttribute("role", "img");
        svg.setAttribute(
          "aria-label",
          `Diagrama ${example.label}, tema ${palette.label}, modo ${entry.mode.label}`
        );
      }
    }
  };

  for (const mode of MODES) {
    const incoming = mode.id === "light" ? config.light : config.dark;
    const themeId = entryByName(config.themes, incoming) ? incoming : "default";
    const card = el("div", {
      class: ["mdprv-settings-chart-card", `mdprv-settings-chart-card--${mode.id}`],
    });
    const entry: CardEntry = { mode, card, themeId };
    cards.push(entry);

    const menu = iconMenu({
      label: `Tema Mermaid do card ${mode.label.toLowerCase()}`,
      iconName: "palette",
      options: menuEntries(config.themes, themeId).map((item) => ({
        value: item.name,
        label: optionLabel(item),
      })),
      value: themeId,
      disabled: !config.editable,
      onChange: (value) => {
        if (!config.editable) {
          return;
        }
        entry.themeId = value;
        config.onChange(mode.id, value);
        paint();
      },
    });

    const bar = el(
      "div",
      { class: "mdprv-settings-preview-bar" },
      el("span", { class: "mdprv-settings-preview-mode" }, mode.label),
      menu
    );

    grid.appendChild(el("div", { class: "mdprv-settings-preview-column" }, bar, card));
  }

  paint();

  return {
    root: el("div", { class: "mdprv-settings-chart-preview" }, grid),
    setExample(id: string): void {
      if (chartExample(id).id === chartExample(exampleId).id) {
        return;
      }
      exampleId = id;
      paint();
    },
  };
}
