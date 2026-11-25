/**
 * Import pipeline for custom Shiki themes.
 *
 * Responsibilities kept together on purpose: bounded body reading, browser
 * mutation checks, wrapper validation, collision detection, highlighter
 * preloading, atomic write and response assembly. Nothing user-provided ever
 * becomes a path: the file name is always `join(dir, <validated-slug>.shiki.json)`.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ShikiThemeEntry } from "../../core/contract";
import {
  codeToHtmlSingle,
  FALLBACK_DARK,
  FALLBACK_LIGHT,
  registerShikiTheme,
} from "../../core/markdown/highlight";
import {
  ShikiThemeError,
  shikiFileName,
  shikiLabel,
  validateShikiCustom,
  type ShikiCustomTheme,
} from "../../core/themes/shiki-custom";
import { SHIKI_THEME_ID_RE } from "../../core/themes/constants";
import { shikiThemeEntries } from "../../core/themes/shiki-index";
import type { ShikiThemeStore } from "../../core/themes/shiki-store";
import { baseHeaders } from "./headers";

/** Hard cap for the request body, independent of `Content-Length`. */
export const MAX_SHIKI_BODY_BYTES = 256 * 1024;

/** Fixed snippet rendered by `/__preview/code` and the import previews. */
export const CODE_PREVIEW_SAMPLE = `interface Theme {
  name: string;
  scheme: "light" | "dark";
}

export function themeCss(theme: Theme): string {
  const { name, scheme } = theme;
  return \`/* \${name} */ :root { color-scheme: \${scheme}; }\`;
}
`;

export interface ShikiPreviewSide {
  html: string;
  background: string;
  foreground: string;
}

export interface ShikiPreview {
  light: ShikiPreviewSide;
  dark: ShikiPreviewSide;
}

export interface ShikiImportResult {
  theme: ShikiThemeEntry;
  preview: ShikiPreview;
}

export interface ShikiImportDeps {
  dir: string | null;
  store: ShikiThemeStore;
}

export class ShikiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ShikiHttpError";
  }
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) {
    return false;
  }
  const host = req.headers.get("host");
  if (!host) {
    return false;
  }
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host === host;
  } catch {
    return false;
  }
}

function fetchSiteAllowed(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === null) {
    return true;
  }
  const value = site.trim().toLowerCase();
  return value === "same-origin" || value === "none";
}

/**
 * Browser mutations require an exact `Origin` and a same-origin fetch site.
 * JSON bodies additionally require `application/json`.
 */
export function requireMutation(req: Request, options: { json: boolean }): Response | null {
  if (!sameOrigin(req) || !fetchSiteAllowed(req)) {
    return textResponse("forbidden", 403);
  }
  if (options.json) {
    const type = (req.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("application/json")) {
      return textResponse("unsupported media type", 415);
    }
  }
  return null;
}

/** Reads a JSON body in streaming mode, aborting once the cap is crossed. */
export async function readJsonBody(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_SHIKI_BODY_BYTES) {
    throw new ShikiHttpError(413, "request body is larger than 256 KiB");
  }
  const body = req.body;
  if (!body) {
    throw new ShikiHttpError(400, "invalid JSON body");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > MAX_SHIKI_BODY_BYTES) {
        throw new ShikiHttpError(413, "request body is larger than 256 KiB");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new ShikiHttpError(400, "invalid JSON body");
  }
}

function entryFor(theme: ShikiCustomTheme): ShikiThemeEntry {
  return {
    name: theme.name,
    label: shikiLabel(theme.name),
    kind: theme.kind,
    source: "custom",
  };
}

async function buildPreview(theme: ShikiCustomTheme): Promise<ShikiPreview> {
  const internal = await registerShikiTheme(theme);
  if (!internal) {
    throw new ShikiHttpError(422, "Shiki could not load the theme");
  }
  const lightTheme = theme.kind === "light" ? internal : FALLBACK_LIGHT;
  const darkTheme = theme.kind === "dark" ? internal : FALLBACK_DARK;
  const [light, dark] = await Promise.all([
    codeToHtmlSingle(CODE_PREVIEW_SAMPLE, "typescript", lightTheme),
    codeToHtmlSingle(CODE_PREVIEW_SAMPLE, "typescript", darkTheme),
  ]);
  return { light, dark };
}

function writeThemeFile(dir: string | null, theme: ShikiCustomTheme): void {
  if (!dir) {
    throw new ShikiHttpError(500, "themes directory is unavailable");
  }
  mkdirSync(dir, { recursive: true });
  const final = join(dir, shikiFileName(theme.name));
  const tmp = join(dir, `.mdprv-${theme.name}-${randomBytes(6).toString("hex")}.tmp`);
  const wrapper = {
    schemaVersion: 1,
    name: theme.name,
    type: theme.kind,
    theme: theme.registration,
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
      throw new ShikiHttpError(409, `theme ${theme.name} already exists`);
    }
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

function mapError(err: unknown): Response {
  if (err instanceof ShikiHttpError) {
    return textResponse(err.message, err.status);
  }
  if (err instanceof ShikiThemeError) {
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

/** `POST /__shiki-themes/preview`: validates and renders, never writes. */
export async function previewShikiImport(req: Request): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    const theme = validateShikiCustom(raw);
    const preview = await buildPreview(theme);
    return jsonResponse({ theme: entryFor(theme), preview });
  } catch (err) {
    return mapError(err);
  }
}

/** `POST /__shiki-themes`: validates, preloads, writes atomically and refreshes. */
export async function importShikiTheme(req: Request, deps: ShikiImportDeps): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    const theme = validateShikiCustom(raw);
    if (deps.store.has(theme.name)) {
      return textResponse(`theme ${theme.name} already exists`, 409);
    }
    const preview = await buildPreview(theme);
    writeThemeFile(deps.dir, theme);
    deps.store.refresh(true);
    return jsonResponse({ theme: entryFor(theme), preview, themes: shikiThemeEntries() }, 201);
  } catch (err) {
    return mapError(err);
  }
}

/** `DELETE /__shiki-themes/<name>`: removes only an existing custom theme. */
export function deleteShikiTheme(req: Request, name: string, deps: ShikiImportDeps): Response {
  const forbidden = requireMutation(req, { json: false });
  if (forbidden) {
    return forbidden;
  }
  if (!SHIKI_THEME_ID_RE.test(name) || !deps.store.has(name)) {
    return textResponse("not found", 404);
  }
  if (!deps.dir) {
    return textResponse("themes directory is unavailable", 500);
  }
  try {
    unlinkSync(join(deps.dir, shikiFileName(name)));
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

/** Shared `GET` payload for the dynamic Shiki catalog. */
export function shikiThemesPayload(store: ShikiThemeStore): {
  themes: ShikiThemeEntry[];
  errors: unknown[];
} {
  return {
    themes: shikiThemeEntries(),
    errors: store.errors(),
  };
}
