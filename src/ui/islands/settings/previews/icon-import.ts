/**
 * Regras puras do importador de pacote de ícones (`icon.json`).
 *
 * O cliente normaliza o `name` para o slug escolhido antes de enviar; o
 * servidor valida com `validateIconPack`, grava atomicamente e devolve o
 * catálogo atualizado (`{ icon, icons }`). A interface comum fica em
 * `components/import-panel.ts`.
 */
import type { IconPackEntry } from "../../../../core/contract";
import { slugifyThemeName } from "./theme-import";

export const ICON_IMPORT_MAX_BYTES = 256 * 1024;

export interface IconImportResult {
  icon: IconPackEntry;
  icons: IconPackEntry[];
}

/** Icon pack slugs share the theme slug syntax. */
export function slugifyIconName(value: string): string {
  return slugifyThemeName(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function buildIconImportPayload(
  text: string,
  name: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") {
    return { ok: false, error: "Cole um icon.json ou selecione um arquivo." };
  }
  if (bytes(text) > ICON_IMPORT_MAX_BYTES) {
    return { ok: false, error: "Arquivo grande demais (máximo 256 KiB)." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "O JSON precisa ser um objeto." };
  }
  const slug = slugifyIconName(name);
  if (slug === "") {
    return { ok: false, error: "Informe um nome para o pacote." };
  }
  return {
    ok: true,
    value: {
      ...parsed,
      name: slug,
      // The runtime contract requires 1; filling it keeps the form short.
      schemaVersion: parsed.schemaVersion ?? 1,
    },
  };
}

/** Name shown in the form, derived from the pasted JSON `name`. */
export function deriveIconName(parsed: unknown): string {
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return slugifyIconName(parsed.name);
  }
  return "";
}

export function iconSlugFromFile(filename: string): string {
  return slugifyIconName(
    filename.replace(/\.icon\.json$/i, "").replace(/\.json$/i, "")
  );
}

export function iconImportError(status: number, body: string): string {
  const detail = body.trim();
  switch (status) {
    case 409:
      return detail || "Já existe um pacote com esse nome (ou é um nome reservado).";
    case 413:
      return "Arquivo grande demais (máximo 256 KiB).";
    case 415:
      return "Envio inválido: use JSON.";
    case 422:
      return detail || "Pacote inválido. Confira schemaVersion, style e icons.";
    case 400:
      return detail || "JSON inválido.";
    case 403:
      return detail || "Pacote embutido não pode ser removido.";
    default:
      return detail || `Falha ao importar (HTTP ${status}).`;
  }
}
