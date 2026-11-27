/**
 * Página Importar: os três importadores de tema em uma única página.
 *
 * Cada bloco usa o mesmo formulário (`components/import-panel.ts`) e só troca
 * as regras de payload/erro e a lista exibida. Importar não aplica o tema: ele
 * entra no catálogo e fica disponível nos menus de Temas, Código e Gráficos.
 */
import type {
  MermaidThemeEntry,
  ShikiThemeEntry,
  ThemeCatalogEntry,
} from "../../../../core/contract";
import { themeLabel } from "../catalog";
import { contentBlock, el, sectionHeader } from "../components";
import {
  renderImportPanel,
  type ImportPanelItem,
} from "../components/import-panel";
import {
  buildMermaidImportPayload,
  deriveMermaidName,
  mermaidImportError,
  mermaidSlugFromFile,
  type MermaidImportResult,
} from "../previews/mermaid-import";
import {
  buildThemeImportPayload,
  deriveThemeName,
  themeImportError,
  themeSlugFromFile,
  type ThemeImportResult,
} from "../previews/theme-import";
import {
  buildImportPayload,
  deriveShikiName,
  shikiImportError,
  shikiSlugFromFile,
  type ShikiImportResult,
} from "../previews/shiki-import";

export interface ImportPageContext {
  catalog: ThemeCatalogEntry[];
  shikiThemes: ShikiThemeEntry[];
  mermaidThemes: MermaidThemeEntry[];
  onThemeImported(result: ThemeImportResult): void;
  onThemeDeleted(name: string): void;
  onShikiImported(result: ShikiImportResult): void;
  onShikiDeleted(name: string): void;
  onMermaidImported(result: MermaidImportResult): void;
  onMermaidDeleted(name: string): void;
}

function themeItem(entry: ThemeCatalogEntry): ImportPanelItem {
  return {
    name: entry.name,
    label: themeLabel(entry.name),
    meta: `${entry.source ?? "user"} · ${entry.kind}`,
  };
}

function userThemes(entries: ThemeCatalogEntry[]): ImportPanelItem[] {
  return entries
    .filter((entry) => entry.source === "user")
    .map(themeItem);
}

function shikiItem(entry: ShikiThemeEntry): ImportPanelItem {
  return {
    name: entry.name,
    label: entry.label,
    meta: `${entry.source} · ${entry.kind}`,
  };
}

function customShiki(entries: ShikiThemeEntry[]): ImportPanelItem[] {
  return entries
    .filter((entry) => entry.source === "custom")
    .map(shikiItem);
}

function mermaidItem(entry: MermaidThemeEntry): ImportPanelItem {
  return {
    name: entry.name,
    label: entry.label,
    meta: `${entry.source} · base ${entry.theme}`,
  };
}

function customMermaid(entries: MermaidThemeEntry[]): ImportPanelItem[] {
  return entries
    .filter((entry) => entry.source === "custom")
    .map(mermaidItem);
}

export function renderImportPage(ctx: ImportPageContext): HTMLElement {
  return el(
    "div",
    { class: "mdprv-settings-page" },
    sectionHeader({
      title: "Importar",
      description: "Adicione temas de cores, Shiki e Mermaid à pasta local de temas.",
    }),
    contentBlock({
      title: "Tema de cores",
      description: "Um theme.json completo, com cores, tipografia e presets.",
      children: [
        renderImportPanel<ThemeCatalogEntry>({
          slug: "theme",
          help: "Aceita um theme.json completo. O arquivo é gravado como <slug>.json na pasta de temas.",
          namePlaceholder: "meu-tema",
          nameMaxLength: 64,
          textareaRows: 10,
          textareaPlaceholder:
            "Cole o JSON do theme.json (cores, tipografia, shiki, mermaid…).",
          endpoint: "/__themes",
          deleteEndpoint: (name) => `/__themes/${encodeURIComponent(name)}`,
          listTitle: "Temas de cores instalados",
          items: userThemes(ctx.catalog),
          toItem: themeItem,
          itemsFrom: userThemes,
          buildPayload: buildThemeImportPayload,
          deriveName: deriveThemeName,
          slugFromFile: themeSlugFromFile,
          errorMessage: themeImportError,
          onImported: (result) => ctx.onThemeImported(result),
          onDeleted: (name) => ctx.onThemeDeleted(name),
        }),
      ],
    }),
    contentBlock({
      title: "Tema Shiki",
      description: "O wrapper .shiki.json ou o JSON cru de um tema VS Code/TextMate.",
      children: [
        renderImportPanel<ShikiThemeEntry>({
          slug: "shiki",
          help: "Aceita o wrapper .shiki.json ou o JSON cru de um tema VS Code/TextMate. O arquivo é gravado como <slug>.shiki.json na pasta de temas.",
          namePlaceholder: "minha-paleta",
          nameMaxLength: 32,
          textareaRows: 10,
          textareaPlaceholder:
            "Cole o JSON do tema (wrapper .shiki.json ou tema VS Code/TextMate).",
          endpoint: "/__shiki-themes",
          deleteEndpoint: (name) => `/__shiki-themes/${encodeURIComponent(name)}`,
          listTitle: "Temas Shiki importados",
          items: customShiki(ctx.shikiThemes),
          toItem: shikiItem,
          itemsFrom: customShiki,
          buildPayload: (text, name) => buildImportPayload(text, name || "tema"),
          deriveName: deriveShikiName,
          slugFromFile: shikiSlugFromFile,
          errorMessage: shikiImportError,
          onImported: (result) => ctx.onShikiImported(result),
          onDeleted: (name) => ctx.onShikiDeleted(name),
        }),
      ],
    }),
    contentBlock({
      title: "Tema Mermaid",
      description: "Um .mermaid.json com schemaVersion, theme base e variables.",
      children: [
        renderImportPanel<MermaidThemeEntry>({
          slug: "mermaid",
          help: "Formato <slug>.mermaid.json: schemaVersion 1, name, theme base opcional e variables. O arquivo é gravado na pasta de temas.",
          namePlaceholder: "meu-diagrama",
          nameMaxLength: 64,
          textareaRows: 10,
          textareaPlaceholder:
            '{\n  "schemaVersion": 1,\n  "name": "meu-diagrama",\n  "theme": "base",\n  "variables": { "primaryColor": "#d97757" }\n}',
          endpoint: "/__mermaid-themes",
          deleteEndpoint: (name) => `/__mermaid-themes/${encodeURIComponent(name)}`,
          listTitle: "Temas Mermaid importados",
          items: customMermaid(ctx.mermaidThemes),
          toItem: mermaidItem,
          itemsFrom: customMermaid,
          buildPayload: buildMermaidImportPayload,
          deriveName: deriveMermaidName,
          slugFromFile: mermaidSlugFromFile,
          errorMessage: mermaidImportError,
          onImported: (result) => ctx.onMermaidImported(result),
          onDeleted: (name) => ctx.onMermaidDeleted(name),
        }),
      ],
    })
  );
}
