/**
 * Regras puras do importador de tema de cores (`theme.json` completo).
 *
 * O cliente normaliza o `name` para o slug escolhido antes de enviar; o
 * servidor valida com `validateTheme`, grava atomicamente e devolve o catálogo
 * atualizado. A interface comum fica em `components/import-panel.ts`.
 */
import type { ThemeCatalogEntry } from "../../../../core/contract";

export const THEME_IMPORT_MAX_BYTES = 256 * 1024;

export interface ThemeImportResult {
  theme: ThemeCatalogEntry;
  themes: ThemeCatalogEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function slugifyThemeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildThemeImportPayload(
  text: string,
  name: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") {
    return { ok: false, error: "Cole um theme.json ou selecione um arquivo." };
  }
  if (bytes(text) > THEME_IMPORT_MAX_BYTES) {
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
  const slug = slugifyThemeName(name);
  if (slug === "") {
    return { ok: false, error: "Informe um nome para o tema." };
  }
  return { ok: true, value: { ...parsed, name: slug } };
}

/** Name shown in the form, derived from the pasted JSON `name`. */
export function deriveThemeName(parsed: unknown): string {
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return slugifyThemeName(parsed.name);
  }
  return "";
}

export function themeSlugFromFile(filename: string): string {
  return slugifyThemeName(filename.replace(/\.json$/i, ""));
}

export function themeImportError(status: number, body: string): string {
  const detail = body.trim();
  switch (status) {
    case 409:
      return detail || "Já existe um tema com esse nome (ou é um tema embutido).";
    case 413:
      return "Arquivo grande demais (máximo 256 KiB).";
    case 415:
      return "Envio inválido: use JSON.";
    case 422:
      return detail || "Tema inválido. Confira as cores e os campos.";
    case 400:
      return detail || "JSON inválido.";
    case 403:
      return detail || "Tema embutido não pode ser removido.";
    default:
      return detail || `Falha ao importar (HTTP ${status}).`;
  }
}
