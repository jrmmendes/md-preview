/**
 * Flags e persistência dos blocos personalizáveis da página Aparência.
 *
 * `mdprv_blocks` guarda quais blocos foram personalizados; os valores em si
 * ficam nas chaves já existentes (`mdprv_font`, `mdprv_loader`) e nas novas
 * `mdprv_shiki`/`mdprv_mermaid` (com espelho no cookie `mdprv_prefs`).
 */
import { isLoaderName, type LoaderName } from "../../../core/loader";
import {
  BLOCK_IDS,
  BLOCKS_STORAGE_KEY,
  blocksFrom,
  type BlockId,
  type Blocks,
  type FontValue,
  type MermaidValue,
  type ShikiValue,
  type Scheme,
  type StoredValues,
} from "./catalog";
import {
  clearLoader,
  clearFontSelection,
  getFontSelection,
  getLoader,
  setFontSelection,
  setLoader,
} from "../../prefs";
import {
  readMermaidPrefs,
  readShikiPrefs,
  writeMermaidPrefs,
  writeShikiPrefs,
} from "../../services/theme-prefs";

export { BLOCKS_STORAGE_KEY };
export const BLOCKS_VERSION = 1;

function localGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function localSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

function localRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function readBlocks(): Blocks {
  const raw = localGet(BLOCKS_STORAGE_KEY);
  if (!raw) {
    return blocksFrom(null);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as { v?: unknown }).v !== BLOCKS_VERSION
    ) {
      return blocksFrom(null);
    }
    return blocksFrom(parsed);
  } catch {
    return blocksFrom(null);
  }
}

export function writeBlocks(blocks: Blocks): void {
  const payload: Record<string, unknown> = { v: BLOCKS_VERSION };
  for (const block of BLOCK_IDS) {
    payload[block] = blocks[block] === true;
  }
  localSet(BLOCKS_STORAGE_KEY, JSON.stringify(payload));
}

export function setCustomized(block: BlockId, enabled: boolean): Blocks {
  const blocks = { ...readBlocks(), [block]: enabled };
  writeBlocks(blocks);
  return blocks;
}

export function readStoredFont(): FontValue | null {
  const selection = getFontSelection();
  if (!selection) {
    return null;
  }
  return {
    family: selection.family,
    stack: selection.stack,
    source: selection.source === "google" ? "google" : "local",
  };
}

export function readStoredLoader(): LoaderName | null {
  const value = getLoader();
  return value !== null && isLoaderName(value) ? value : null;
}

export function readStoredValues(): StoredValues {
  return {
    font: readStoredFont(),
    loader: readStoredLoader(),
    shiki: readShikiPrefs(),
    mermaid: readMermaidPrefs(),
  };
}

export function writeFontValue(value: FontValue | null): void {
  if (!value) {
    clearFontSelection();
    return;
  }
  setFontSelection({
    family: value.family,
    source: value.source,
    stack: value.stack,
  });
}

export function writeLoaderValue(value: LoaderName | null): void {
  if (!value) {
    clearLoader();
    return;
  }
  setLoader(value);
}

export function writeShikiValue(value: ShikiValue | null): void {
  writeShikiPrefs(value);
}

export function writeMermaidValue(value: MermaidValue | null): void {
  writeMermaidPrefs(value);
}

/** Writes the preset values of a block without touching its custom flag. */
export function applyPresetValues(values: {
  font?: FontValue | null;
  loader?: LoaderName | null;
  shiki?: ShikiValue | null;
  mermaid?: MermaidValue | null;
}): void {
  if (values.font) {
    writeFontValue(values.font);
  }
  if (values.loader) {
    writeLoaderValue(values.loader);
  }
  if (values.shiki) {
    writeShikiValue(values.shiki);
  }
  if (values.mermaid) {
    writeMermaidValue(values.mermaid);
  }
}

/** Removes the stored value of a block (used when "Personalizar" is off). */
export function clearBlockValue(block: BlockId): void {
  switch (block) {
    case "fonte":
      clearFontSelection();
      return;
    case "loader":
      clearLoader();
      return;
    case "codigo":
      writeShikiValue(null);
      return;
    case "graficos":
      writeMermaidValue(null);
      return;
  }
}

export type { BlockId, Blocks, FontValue, MermaidValue, ShikiValue, Scheme, StoredValues };
