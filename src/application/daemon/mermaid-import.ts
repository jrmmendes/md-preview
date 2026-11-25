/**
 * Import/delete pipeline for Mermaid themes (`<slug>.mermaid.json`).
 *
 * Mirrors the Shiki importer: body cap, browser mutation checks, validator,
 * atomic non-overwriting 0600 write and catalog refresh.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { MermaidThemeEntry } from "../../core/contract";
import { THEME_NAME_RE } from "../../core/themes/constants";
import {
  MermaidThemeError,
  mermaidFileName,
  validateMermaidCustom,
} from "../../core/themes/mermaid-custom";
import {
  mermaidThemeEntries,
  type MermaidThemeStore,
} from "../../core/themes/mermaid-index";
import {
  jsonResponse,
  readJsonBody,
  requireMutation,
  ShikiHttpError,
} from "./shiki-import";
import { baseHeaders } from "./headers";

export interface MermaidImportDeps {
  dir: string | null;
  store: MermaidThemeStore;
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapError(err: unknown): Response {
  if (err instanceof ShikiHttpError) {
    return textResponse(err.message, err.status);
  }
  if (err instanceof MermaidThemeError) {
    switch (err.code) {
      case "exists":
        return textResponse(err.message, 409);
      case "too-many":
        return textResponse(err.message, 422);
      case "too-large":
        return textResponse(err.message, 413);
      default:
        return textResponse(err.message, 422);
    }
  }
  return textResponse(err instanceof Error ? err.message : String(err), 500);
}

function entryFor(name: string, deps: MermaidImportDeps): MermaidThemeEntry {
  const found = deps.store.list().find((item) => item.name === name);
  if (!found) {
    throw new ShikiHttpError(500, `Mermaid theme ${name} was not found after import`);
  }
  return {
    name: found.name,
    label: found.label,
    source: found.source,
    theme: found.theme,
    variables: found.variables,
  };
}

function writeThemeFile(
  dir: string | null,
  theme: ReturnType<typeof validateMermaidCustom>
): void {
  if (!dir) {
    throw new ShikiHttpError(500, "themes directory is unavailable");
  }
  mkdirSync(dir, { recursive: true });
  const final = join(dir, mermaidFileName(theme.name));
  const tmp = join(dir, `.mdprv-${theme.name}-${randomBytes(6).toString("hex")}.tmp`);
  const wrapper = {
    schemaVersion: 1,
    name: theme.name,
    theme: theme.theme,
    variables: theme.variables,
  };
  writeFileSync(tmp, JSON.stringify(wrapper, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  try {
    // `link` never overwrites: an existing target fails with EEXIST.
    linkSync(tmp, final);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ShikiHttpError(409, `Mermaid theme ${theme.name} already exists`);
    }
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/** `POST /__mermaid-themes`: validates, writes atomically and refreshes. */
export async function importMermaidTheme(
  req: Request,
  deps: MermaidImportDeps
): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    if (!isRecord(raw) || typeof raw.name !== "string" || !THEME_NAME_RE.test(raw.name)) {
      return textResponse("name must match ^[a-z0-9][a-z0-9-]{0,63}$", 422);
    }
    const theme = validateMermaidCustom(raw, raw.name);
    if (deps.store.has(theme.name)) {
      return textResponse(`Mermaid theme ${theme.name} already exists`, 409);
    }
    writeThemeFile(deps.dir, theme);
    deps.store.refresh(true);
    return jsonResponse(
      {
        theme: entryFor(theme.name, deps),
        themes: mermaidThemeEntries(),
        errors: deps.store.errors(),
      },
      201
    );
  } catch (err) {
    return mapError(err);
  }
}

/** `DELETE /__mermaid-themes/<name>`: removes only an imported theme. */
export function deleteMermaidTheme(
  req: Request,
  name: string,
  deps: MermaidImportDeps
): Response {
  const forbidden = requireMutation(req, { json: false });
  if (forbidden) {
    return forbidden;
  }
  if (!THEME_NAME_RE.test(name)) {
    return textResponse("not found", 404);
  }
  const known = mermaidThemeEntries().find((item) => item.name === name);
  if (!known) {
    return textResponse("not found", 404);
  }
  if (known.source !== "custom") {
    return textResponse(`Mermaid theme ${name} is builtin and cannot be removed`, 403);
  }
  if (!deps.dir) {
    return textResponse("themes directory is unavailable", 500);
  }
  try {
    unlinkSync(join(deps.dir, mermaidFileName(name)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return textResponse("not found", 404);
    }
    return textResponse(err instanceof Error ? err.message : String(err), 500);
  }
  deps.store.refresh(true);
  return new Response(null, {
    status: 204,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}
