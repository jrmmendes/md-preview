/**
 * Import/delete pipeline for full color themes (`theme.json`).
 *
 * The body is capped by the existing streaming reader, validation uses the
 * authoritative `validateTheme`, and the write is atomic and never overwrites.
 * The file name is always `join(dir, <validated-slug>.json)`.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ThemeCatalogEntry } from "../../core/contract";
import {
  ColorThemeError,
  colorThemeFileName,
  isThemeSlug,
  validateColorTheme,
} from "../../core/themes/color-import";
import { themeCatalog, themeCatalogEntry } from "../../core/themes/catalog";
import type { AutoTheme } from "../../core/themes/types";
import type { ThemeStore } from "../../core/themes/store";
import {
  jsonResponse,
  readJsonBody,
  requireMutation,
  ShikiHttpError,
} from "./shiki-import";
import { baseHeaders } from "./headers";

export interface ThemeImportDeps {
  dir: string | null;
  themes: ThemeStore;
}

export interface ThemeImportResult {
  theme: ThemeCatalogEntry;
  themes: ThemeCatalogEntry[];
  errors: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

function mapError(err: unknown): Response {
  if (err instanceof ShikiHttpError) {
    return textResponse(err.message, err.status);
  }
  if (err instanceof ColorThemeError) {
    if (err.code === "exists") {
      return textResponse(err.message, 409);
    }
    if (err.code === "too-large") {
      return textResponse(err.message, 413);
    }
    return textResponse(err.message, 422);
  }
  return textResponse(err instanceof Error ? err.message : String(err), 500);
}

function writeThemeFile(dir: string | null, name: string, raw: Record<string, unknown>): void {
  if (!dir) {
    throw new ShikiHttpError(500, "themes directory is unavailable");
  }
  mkdirSync(dir, { recursive: true });
  const final = join(dir, colorThemeFileName(name));
  const tmp = join(dir, `.mdprv-${name}-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify({ ...raw, name }, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  try {
    // `link` never overwrites: an existing target fails with EEXIST.
    linkSync(tmp, final);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ShikiHttpError(409, `theme ${name} already exists`);
    }
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/**
 * An `auto` theme is only useful when both variants resolve in the merged
 * store; importing one that would be dropped is rejected before any write.
 */
function checkAutoVariants(
  theme: ReturnType<typeof validateColorTheme>,
  deps: ThemeImportDeps
): void {
  if (theme.kind !== "auto") {
    return;
  }
  const auto = theme as AutoTheme;
  for (const face of ["light", "dark"] as const) {
    const variant = auto.variants[face];
    if (variant === auto.name || !deps.themes.has(variant)) {
      throw new ShikiHttpError(
        422,
        `variants.${face} must reference an existing theme (${variant})`
      );
    }
  }
}

/** `POST /__themes`: validates, writes atomically and refreshes the store. */
export async function importColorTheme(
  req: Request,
  deps: ThemeImportDeps
): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    if (!isRecord(raw) || !isThemeSlug(raw.name)) {
      return textResponse("name must match ^[a-z0-9][a-z0-9-]{0,63}$", 422);
    }
    const name = raw.name;
    const theme = validateColorTheme(name, raw);
    checkAutoVariants(theme, deps);
    const listed = deps.themes.list().find((item) => item.name === name);
    if (listed) {
      return textResponse(
        listed.source === "builtin"
          ? `theme ${name} is builtin and cannot be overwritten`
          : `theme ${name} already exists`,
        409
      );
    }
    if (deps.themes.has(name)) {
      return textResponse(`theme ${name} already exists`, 409);
    }
    writeThemeFile(deps.dir, name, raw);
    deps.themes.refresh(true);
    if (!deps.themes.has(name)) {
      return textResponse(`theme ${name} could not be resolved after import`, 422);
    }
    return jsonResponse(
      {
        theme: themeCatalogEntry(
          deps.themes.get(name),
          "user"
        ),
        themes: themeCatalog(deps.themes),
        errors: deps.themes.errors(),
      } satisfies ThemeImportResult,
      201
    );
  } catch (err) {
    return mapError(err);
  }
}

/** `DELETE /__themes/<name>`: removes only an imported (user) theme. */
export function deleteColorTheme(
  req: Request,
  name: string,
  deps: ThemeImportDeps
): Response {
  const forbidden = requireMutation(req, { json: false });
  if (forbidden) {
    return forbidden;
  }
  if (!isThemeSlug(name)) {
    return textResponse("not found", 404);
  }
  const listed = deps.themes.list().find((item) => item.name === name);
  if (!listed) {
    return textResponse("not found", 404);
  }
  if (listed.source !== "user") {
    return textResponse(`theme ${name} is builtin and cannot be removed`, 403);
  }
  if (!deps.dir) {
    return textResponse("themes directory is unavailable", 500);
  }
  try {
    unlinkSync(join(deps.dir, colorThemeFileName(name)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return textResponse("not found", 404);
    }
    return textResponse(err instanceof Error ? err.message : String(err), 500);
  }
  deps.themes.refresh(true);
  return new Response(null, {
    status: 204,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}
