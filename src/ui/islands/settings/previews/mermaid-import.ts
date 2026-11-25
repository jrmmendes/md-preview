/**
 * Regras puras do importador de tema Mermaid (`.mermaid.json`).
 *
 * O cliente normaliza o slug antes de enviar; o servidor valida chaves/valores,
 * grava `<slug>.mermaid.json` atomicamente e devolve o catálogo dinâmico. A
 * interface comum fica em `components/import-panel.ts`.
 */
import type { MermaidThemeEntry } from "../../../../core/contract";

export const MERMAID_IMPORT_MAX_BYTES = 256 * 1024;

export interface MermaidImportResult {
  theme: MermaidThemeEntry;
  themes: MermaidThemeEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function slugifyMermaidName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildMermaidImportPayload(
  text: string,
  name: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (text.trim() === "") {
    return { ok: false, error: "Cole o JSON do tema Mermaid ou selecione um arquivo." };
  }
  if (bytes(text) > MERMAID_IMPORT_MAX_BYTES) {
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
  const slug = slugifyMermaidName(name);
  if (slug === "") {
    return { ok: false, error: "Informe um nome para o tema." };
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      ...parsed,
      name: slug,
    },
  };
}

/** Name shown in the form, derived from the pasted JSON `name`. */
export function deriveMermaidName(parsed: unknown): string {
  if (isRecord(parsed) && typeof parsed.name === "string") {
    return slugifyMermaidName(parsed.name);
  }
  return "";
}

export function mermaidSlugFromFile(filename: string): string {
  return slugifyMermaidName(
    filename.replace(/\.mermaid\.json$/i, "").replace(/\.json$/i, "")
  );
}

export function mermaidImportError(status: number, body: string): string {
  const detail = body.trim();
  switch (status) {
    case 409:
      return detail || "Já existe um tema Mermaid com esse nome (ou é embutido).";
    case 413:
      return "Arquivo grande demais (máximo 256 KiB).";
    case 415:
      return "Envio inválido: use JSON.";
    case 422:
      return detail || "Tema Mermaid inválido. Confira as variáveis.";
    case 400:
      return detail || "JSON inválido.";
    case 403:
      return detail || "Tema Mermaid embutido não pode ser removido.";
    default:
      return detail || `Falha ao importar (HTTP ${status}).`;
  }
}
