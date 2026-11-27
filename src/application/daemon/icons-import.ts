/**
 * Import/delete pipeline for icon packs.
 *
 * Mirrors the emoji importer: the file name is always
 * `join(dir, <validated-slug>.json)`, so no user-provided string ever becomes a
 * path. Writes are atomic and never overwrite; builtins and existing packs are
 * rejected with 409 before the temporary file is created.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { IconPackEntry } from "../../core/contract";
import { isIconSlug, isReservedIconPack } from "../../core/icons/constants";
import type { IconPackInfo } from "../../core/icons/types";
import { iconPackPath, type IconStore } from "../../core/icons/store";
import { IconPackError, validateIconPack } from "../../core/icons/validate";
import { baseHeaders } from "./headers";
import {
  jsonResponse,
  readJsonBody,
  requireMutation,
  ShikiHttpError,
} from "./shiki-import";

export interface IconImportDeps {
  dir: string | null;
  store: IconStore;
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
  if (err instanceof IconPackError) {
    switch (err.code) {
      case "exists":
        return textResponse(err.message, 409);
      case "too-large":
        return textResponse(err.message, 413);
      case "too-many":
        return textResponse(err.message, 422);
      default:
        return textResponse(err.message, 422);
    }
  }
  return textResponse(err instanceof Error ? err.message : String(err), 500);
}

function entryOf(info: IconPackInfo): IconPackEntry {
  const out: IconPackEntry = {
    name: info.name,
    label: info.label,
    style: info.style,
    source: info.source,
    count: info.count,
  };
  if (info.default !== undefined) out.default = info.default;
  if (info.description !== undefined) out.description = info.description;
  if (info.license !== undefined) out.license = info.license;
  if (info.attribution !== undefined) out.attribution = info.attribution;
  return out;
}

export function iconEntry(name: string, store: IconStore): IconPackEntry {
  const listed = store.list().find((item) => item.name === name);
  if (listed) {
    return entryOf(listed);
  }
  const pack = store.get(name);
  return {
    name: pack.name,
    label: pack.label ?? pack.name,
    style: pack.style,
    source: "user",
    count: Object.keys(pack.icons).length,
  };
}

function writePackFile(dir: string | null, name: string, raw: unknown): void {
  if (!dir) {
    throw new ShikiHttpError(500, "icons directory is unavailable");
  }
  mkdirSync(dir, { recursive: true });
  const final = iconPackPath(dir, name);
  const tmp = join(dir, `.mdprv-${name}-${randomBytes(6).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify({ ...(raw as Record<string, unknown>), name }, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  try {
    // `link` never overwrites: an existing target fails with EEXIST.
    linkSync(tmp, final);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ShikiHttpError(409, `icon pack ${name} already exists`);
    }
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/** `POST /__icons`: validates, writes atomically and refreshes the store. */
export async function importIconPack(req: Request, deps: IconImportDeps): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    if (!isIconSlug((raw as { name?: unknown } | null)?.name)) {
      return textResponse("name must match ^[a-z0-9][a-z0-9-]{0,63}$", 422);
    }
    const name = (raw as { name: string }).name;
    if (isReservedIconPack(name)) {
      return textResponse(`icon pack name ${name} is reserved and cannot be imported`, 409);
    }
    validateIconPack(name, raw);
    const listed = deps.store.list().find((item) => item.name === name);
    if (listed) {
      return textResponse(
        listed.source === "builtin"
          ? `icon pack ${name} is builtin and cannot be overwritten`
          : `icon pack ${name} already exists`,
        409
      );
    }
    writePackFile(deps.dir, name, raw);
    deps.store.refresh(true);
    if (!deps.store.has(name)) {
      return textResponse(`icon pack ${name} could not be loaded after import`, 422);
    }
    return jsonResponse(
      {
        icon: iconEntry(name, deps.store),
        icons: deps.store.list().map(entryOf),
        errors: deps.store.errors(),
      },
      201
    );
  } catch (err) {
    return mapError(err);
  }
}

/** `DELETE /__icons/<name>`: removes only an imported (user) pack. */
export function deleteIconPack(req: Request, name: string, deps: IconImportDeps): Response {
  const forbidden = requireMutation(req, { json: false });
  if (forbidden) {
    return forbidden;
  }
  if (!isIconSlug(name)) {
    return textResponse("not found", 404);
  }
  if (isReservedIconPack(name)) {
    return textResponse(`icon pack ${name} is reserved and cannot be removed`, 403);
  }
  const listed = deps.store.list().find((item) => item.name === name);
  if (!listed) {
    return textResponse("not found", 404);
  }
  if (listed.source !== "user") {
    return textResponse(`icon pack ${name} is builtin and cannot be removed`, 403);
  }
  if (!deps.dir) {
    return textResponse("icons directory is unavailable", 500);
  }
  try {
    unlinkSync(iconPackPath(deps.dir, name));
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

/** Shared `GET` payload for the dynamic icon catalog. */
export function iconsPayload(store: IconStore): {
  icons: IconPackEntry[];
  errors: unknown[];
} {
  return { icons: store.list().map(entryOf), errors: store.errors() };
}
