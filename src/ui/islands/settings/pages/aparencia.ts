/**
 * Página Aparência: Fonte, Loader, Código e Gráficos.
 *
 * A seleção do tema de cores fica em Temas e as importações em
 * Temas → Importar. A página só monta o DOM a partir do estado; toda mutação é
 * feita pelos callbacks do `AppearanceContext` (implementados no `index.ts`).
 */
import type { LoaderName } from "../../../../core/loader";
import type { ShikiThemeName, MermaidThemeName } from "../../../../core/themes/constants";
import type { MermaidThemeEntry, ShikiThemeEntry } from "../../../../core/contract";
import type { FontPickerValue } from "../../font-picker";
import { createFontPicker } from "../../font-picker";
import {
  blockMeta,
  customizableBlock,
  el,
  iconMenu,
  loaderGrid,
  sectionHeader,
} from "../components";
import type {
  BlockId,
  Blocks,
  MermaidValue,
  ResolvedBlocks,
  ShikiValue,
} from "../catalog";
import { renderCodePreviews } from "../previews/code";
import {
  CHART_EXAMPLES,
  chartExample,
  renderChartsPreview,
} from "../previews/charts";

export interface AppearanceContext {
  blocks: Blocks;
  resolved: ResolvedBlocks;
  exampleId: string;
  toggleBlock(block: BlockId, enabled: boolean): void;
  restoreBlock(block: BlockId): void;
  changeFont(value: FontPickerValue): void;
  changeLoader(value: LoaderName): void;
  changeShiki(face: "light" | "dark", value: ShikiThemeName): void;
  changeMermaid(face: "light" | "dark", value: MermaidThemeName): void;
  changeExample(id: string): void;
  openImportPage(): void;
  shikiThemes: ShikiThemeEntry[];
  mermaidThemes: MermaidThemeEntry[];
}

function blockOptions(
  ctx: AppearanceContext,
  block: BlockId,
  extra: { onImport?: () => void; extras?: HTMLElement[] } = {}
): ReturnType<typeof blockMeta> {
  return blockMeta({
    block,
    customized: ctx.blocks[block],
    onToggle: (checked) => ctx.toggleBlock(block, checked),
    onRestore: () => ctx.restoreBlock(block),
    onImport: extra.onImport,
    extras: extra.extras,
  });
}

export function renderAppearancePage(ctx: AppearanceContext): HTMLElement {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(
    sectionHeader({
      title: "Aparência",
      description: "Fonte, loader, código e gráficos do documento.",
    })
  );

  const fontBlock = customizableBlock({
    title: "Fonte",
    description:
      "Fonte usada no texto renderizado. Famílias indisponíveis usam o fallback da stack.",
    block: "fonte",
    meta: blockOptions(ctx, "fonte"),
    children: [
      (() => {
        const resolved = ctx.resolved.fonte;
        const extra =
          resolved.value.family !== ""
            ? [
                {
                  value: resolved.value.family,
                  label: resolved.value.family,
                  stack: resolved.value.stack,
                },
              ]
            : [];
        const picker = createFontPicker({
          value: resolved.value.family,
          stack: resolved.value.stack,
          options: extra,
          disabled: !resolved.customized,
          label: "Fonte do documento",
          onChange: (value) => ctx.changeFont(value),
        });
        return picker.root;
      })(),
    ],
  });

  const loaderBlock = customizableBlock({
    title: "Loader",
    description:
      "Prévia animada das seis opções exibidas enquanto um documento carrega.",
    block: "loader",
    meta: blockOptions(ctx, "loader"),
    children: [
      loaderGrid({
        value: ctx.resolved.loader.value,
        disabled: !ctx.resolved.loader.customized,
        onChange: (value) => ctx.changeLoader(value),
      }),
    ],
  });

  const codeBlock = customizableBlock({
    title: "Código",
    description: "Prévia dos temas Shiki nos modos claro e escuro.",
    block: "codigo",
    meta: blockOptions(ctx, "codigo", { onImport: () => ctx.openImportPage() }),
    children: [
      (() => {
        const value: ShikiValue = ctx.resolved.codigo.value;
        return renderCodePreviews({
          light: value.light,
          dark: value.dark,
          themes: ctx.shikiThemes,
          editable: ctx.resolved.codigo.customized && ctx.shikiThemes.length > 0,
          onChange: (face, theme) => ctx.changeShiki(face, theme),
        });
      })(),
    ],
  });

  const example = chartExample(ctx.exampleId);
  const exampleMenu = iconMenu({
    label: `Exemplo de diagrama: ${example.label}`,
    iconName: "layers",
    className: "mdprv-settings-chart-example",
    options: CHART_EXAMPLES.map((item) => ({
      value: item.id,
      label: item.label,
    })),
    value: example.id,
    onChange: (value) => ctx.changeExample(value),
  });

  const chartsBlock = customizableBlock({
    title: "Gráficos",
    description:
      "Tema Mermaid e exemplos de diagramas nos modos claro e escuro.",
    block: "graficos",
    meta: blockOptions(ctx, "graficos", {
      onImport: () => ctx.openImportPage(),
      extras: [exampleMenu],
    }),
    children: [
      (() => {
        const value: MermaidValue = ctx.resolved.graficos.value;
        return renderChartsPreview({
          light: value.light,
          dark: value.dark,
          exampleId: ctx.exampleId,
          editable: ctx.resolved.graficos.customized,
          themes: ctx.mermaidThemes,
          onChange: (face, theme) => ctx.changeMermaid(face, theme),
        });
      })(),
    ],
  });

  fragment.appendChild(
    el(
      "div",
      { class: "mdprv-settings-appearance-blocks" },
      fontBlock,
      loaderBlock,
      codeBlock,
      chartsBlock
    )
  );

  return el("div", { class: "mdprv-settings-page" }, fragment);
}
