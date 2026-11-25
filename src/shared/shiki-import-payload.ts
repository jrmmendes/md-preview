/**
 * Pure payload builder for the Shiki importer.
 *
 * Lives in `shared/` so the same rules can be unit-tested without a DOM and
 * reused by the settings island.
 */
const MAX_BYTES = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Lowercase slug used for new imports: `Minha Paleta` -> `minha-paleta`. */
export function slugifyShikiName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/**
 * Detects a full color theme (`theme.json`) pasted into the Shiki importer.
 * Color themes carry `colors` at the root and never a `theme` wrapper.
 */
export function isColorThemeJson(value: unknown): boolean {
  if (!isRecord(value) || isRecord(value.theme)) {
    return false;
  }
  if (!isRecord(value.colors)) {
    return false;
  }
  return (
    value.schemaVersion === 1 ||
    "kind" in value ||
    "shiki" in value ||
    "mermaid" in value ||
    "variants" in value
  );
}

export const COLOR_THEME_GUARD_MESSAGE =
  "Isto é um tema de cores (theme.json), não um tema Shiki. " +
  "Importe em Temas → Importar.";

/**
 * Accepts either the wrapper or a bare VS Code/TextMate theme and returns the
 * payload sent to the server. Syntax errors are surfaced before any request.
 */
export function buildImportPayload(
  text: string,
  name: string
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (text.trim() === "") {
    return { ok: false, error: "Cole um JSON de tema ou selecione um arquivo." };
  }
  if (bytes(text) > MAX_BYTES) {
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
  if (isColorThemeJson(parsed)) {
    return { ok: false, error: COLOR_THEME_GUARD_MESSAGE };
  }
  const slug = slugifyShikiName(name);
  if (slug === "") {
    return { ok: false, error: "Informe um nome para o tema." };
  }
  const wrapped =
    "schemaVersion" in parsed || "theme" in parsed
      ? { ...parsed, name: slug }
      : {
          schemaVersion: 1,
          name: slug,
          ...(typeof parsed.type === "string" ? { type: parsed.type } : {}),
          theme: { ...parsed, name: slug },
        };
  if (isRecord((wrapped as Record<string, unknown>).theme)) {
    const theme = (wrapped as Record<string, unknown>).theme as Record<string, unknown>;
    if ("name" in theme) {
      theme.name = slug;
    }
  }
  return { ok: true, value: wrapped };
}
