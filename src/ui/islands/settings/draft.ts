/**
 * Rascunho em memória do modal de configurações.
 *
 * O modal nunca altera o documento, cookies ou `localStorage` enquanto o
 * usuário edita: cada controle produz um novo `SettingsSnapshot` (imutável).
 * `applied` guarda o estado efetivo da página; `draft` guarda as edições.
 * Salvar promove o rascunho (`commitSnapshot`) e fechar o descarta
 * (`discardSnapshot`). Sem DOM para poder ser testado em `bun test`.
 */
import type { ThemeCatalogPreset } from "../../../core/contract";
import {
  presetValues,
  resolveBlocks,
  resolvePresets,
  type BlockId,
  type Blocks,
  type PageThemeData,
  type ResolvedBlocks,
  type Scheme,
  type StoredValues,
} from "./catalog";

type Presets = { light: ThemeCatalogPreset; dark: ThemeCatalogPreset };

export interface SettingsSnapshot {
  themeName: string;
  scheme: Scheme;
  blocks: Blocks;
  stored: StoredValues;
  /** Active emoji pack slug; applied through the `mdprv_emoji` cookie. */
  emojiName: string;
  exampleId: string;
  zoom: number;
  simpleTables: boolean;
  simpleDiffs: boolean;
  tableWrap: boolean;
}

export function cloneSnapshot(value: SettingsSnapshot): SettingsSnapshot {
  return {
    themeName: value.themeName,
    scheme: value.scheme,
    blocks: { ...value.blocks },
    stored: {
      font: value.stored.font ? { ...value.stored.font } : null,
      loader: value.stored.loader,
      shiki: value.stored.shiki ? { ...value.stored.shiki } : null,
      mermaid: value.stored.mermaid ? { ...value.stored.mermaid } : null,
    },
    emojiName: value.emojiName,
    exampleId: value.exampleId,
    zoom: value.zoom,
    simpleTables: value.simpleTables,
    simpleDiffs: value.simpleDiffs,
    tableWrap: value.tableWrap,
  };
}

/**
 * The chart example is a view preference of the modal, not a setting: it
 * repaints the preview live and must never make the draft dirty.
 */
function comparableSnapshot(value: SettingsSnapshot): string {
  return JSON.stringify({ ...value, exampleId: "" });
}

function sameSnapshot(left: SettingsSnapshot, right: SettingsSnapshot): boolean {
  return comparableSnapshot(left) === comparableSnapshot(right);
}

export function isDraftDirty(
  applied: SettingsSnapshot,
  draft: SettingsSnapshot
): boolean {
  return !sameSnapshot(applied, draft);
}

/** Called only when the user saves; the caller writes the snapshot out. */
export function commitSnapshot(
  applied: SettingsSnapshot,
  draft: SettingsSnapshot
): SettingsSnapshot {
  return cloneSnapshot(draft);
}

/** Called when the modal closes without saving. */
export function discardSnapshot(applied: SettingsSnapshot): SettingsSnapshot {
  return cloneSnapshot(applied);
}

function clearStored(stored: StoredValues, block: BlockId): void {
  switch (block) {
    case "fonte":
      stored.font = null;
      return;
    case "loader":
      stored.loader = null;
      return;
    case "codigo":
      stored.shiki = null;
      return;
    case "graficos":
      stored.mermaid = null;
      return;
  }
}

function assignPreset(
  stored: StoredValues,
  values: Partial<StoredValues>
): void {
  if (values.font !== undefined) {
    stored.font = values.font ? { ...values.font } : null;
  }
  if (values.loader !== undefined) {
    stored.loader = values.loader;
  }
  if (values.shiki !== undefined) {
    stored.shiki = values.shiki ? { ...values.shiki } : null;
  }
  if (values.mermaid !== undefined) {
    stored.mermaid = values.mermaid ? { ...values.mermaid } : null;
  }
}

/** Lápis ligado: copia o preset para o rascunho; desligado: descarta o override. */
export function setDraftCustomized(
  draft: SettingsSnapshot,
  block: BlockId,
  enabled: boolean,
  presets: Presets,
  scheme: Scheme
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  next.blocks = { ...next.blocks, [block]: enabled };
  if (enabled) {
    assignPreset(next.stored, presetValues(block, presets, scheme));
  } else {
    clearStored(next.stored, block);
  }
  return next;
}

/** Seta circular: volta ao preset mantendo o bloco personalizado. */
export function restoreDraftBlock(
  draft: SettingsSnapshot,
  block: BlockId,
  presets: Presets,
  scheme: Scheme
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  assignPreset(next.stored, presetValues(block, presets, scheme));
  return next;
}

export function setDraftTheme(
  draft: SettingsSnapshot,
  themeName: string,
  scheme: Scheme
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), themeName, scheme };
}

export function setDraftEmoji(
  draft: SettingsSnapshot,
  emojiName: string
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), emojiName };
}

export function setDraftFont(
  draft: SettingsSnapshot,
  value: StoredValues["font"]
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  next.stored.font = value ? { ...value } : null;
  return next;
}

export function setDraftLoader(
  draft: SettingsSnapshot,
  value: StoredValues["loader"]
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  next.stored.loader = value;
  return next;
}

export function setDraftShiki(
  draft: SettingsSnapshot,
  value: StoredValues["shiki"]
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  next.stored.shiki = value ? { ...value } : null;
  return next;
}

export function setDraftMermaid(
  draft: SettingsSnapshot,
  value: StoredValues["mermaid"]
): SettingsSnapshot {
  const next = cloneSnapshot(draft);
  next.stored.mermaid = value ? { ...value } : null;
  return next;
}

export function setDraftExample(
  draft: SettingsSnapshot,
  exampleId: string
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), exampleId };
}

export function setDraftZoom(
  draft: SettingsSnapshot,
  zoom: number
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), zoom };
}

export function setDraftSimpleTables(
  draft: SettingsSnapshot,
  value: boolean
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), simpleTables: value };
}

export function setDraftSimpleDiffs(
  draft: SettingsSnapshot,
  value: boolean
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), simpleDiffs: value };
}

export function setDraftTableWrap(
  draft: SettingsSnapshot,
  value: boolean
): SettingsSnapshot {
  return { ...cloneSnapshot(draft), tableWrap: value };
}

/** Effective blocks for a snapshot; used by the previews and by save. */
export function effectiveBlocks(
  data: PageThemeData,
  snapshot: SettingsSnapshot
): ResolvedBlocks | null {
  const presets = resolvePresets(data, snapshot.themeName, snapshot.scheme);
  if (!presets) {
    return null;
  }
  return resolveBlocks({
    blocks: snapshot.blocks,
    stored: snapshot.stored,
    presets,
    scheme: snapshot.scheme,
    shikiThemes: data.shikiThemes,
    mermaidThemes: data.mermaidThemes ?? [],
  });
}

/**
 * Shiki e Mermaid são renderizados no servidor; trocar o tema também exige
 * recarregar o CSS. Fonte, loader, zoom e modos simples aplicam ao vivo.
 */
export function needsReload(
  applied: SettingsSnapshot,
  draft: SettingsSnapshot,
  data: PageThemeData
): boolean {
  if (applied.themeName !== draft.themeName) {
    return true;
  }
  if (applied.scheme !== draft.scheme) {
    return true;
  }
  // Emoji packs expand `:shortcode:` during the server render.
  if (applied.emojiName !== draft.emojiName) {
    return true;
  }
  const before = effectiveBlocks(data, applied);
  const after = effectiveBlocks(data, draft);
  if (!before || !after) {
    return true;
  }
  return (
    before.codigo.value.light !== after.codigo.value.light ||
    before.codigo.value.dark !== after.codigo.value.dark ||
    before.graficos.value.light !== after.graficos.value.light ||
    before.graficos.value.dark !== after.graficos.value.dark
  );
}
