/**
 * Regras puras do importador de tema Shiki.
 *
 * Parsing/normalização ficam no cliente para que JSON cru de VS
 * Code/TextMate vire o wrapper `.shiki.json`; o servidor continua sendo a
 * autoridade final (regex, cotas e validação cor a cor). A interface comum
 * fica em `components/import-panel.ts`.
 */
import type { ShikiThemeEntry } from "../../../../core/contract";
import {
  buildImportPayload,
  COLOR_THEME_GUARD_MESSAGE,
  isColorThemeJson,
  slugifyShikiName,
} from "../../../../shared/shiki-import-payload";

export { buildImportPayload, COLOR_THEME_GUARD_MESSAGE, isColorThemeJson, slugifyShikiName };

export const SHIKI_IMPORT_MAX_BYTES = 256 * 1024;

export interface ShikiImportResult {
  theme: ShikiThemeEntry;
  themes: ShikiThemeEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Name shown in the form, derived from the wrapper or a bare VS Code theme. */
export function deriveShikiName(parsed: unknown): string {
  if (!isRecord(parsed)) {
    return "";
  }
  const theme = isRecord(parsed.theme) ? parsed.theme : parsed;
  const candidate =
    typeof theme.name === "string"
      ? theme.name
      : typeof theme.displayName === "string"
        ? theme.displayName
        : "";
  return slugifyShikiName(candidate);
}

export function shikiSlugFromFile(filename: string): string {
  return slugifyShikiName(filename.replace(/\.shiki\.json$/i, "").replace(/\.json$/i, ""));
}

export function shikiImportError(status: number, body: string): string {
  const detail = body.trim();
  switch (status) {
    case 409:
      return detail || "Já existe um tema com esse nome.";
    case 413:
      return "Arquivo grande demais (máximo 256 KiB).";
    case 415:
      return "Envio inválido: use JSON.";
    case 422:
      return detail || "Tema inválido. Confira as cores e os campos.";
    case 400:
      return detail || "JSON inválido.";
    case 403:
      return "Ação bloqueada pelo daemon.";
    default:
      return detail || `Falha ao importar (HTTP ${status}).`;
  }
}
