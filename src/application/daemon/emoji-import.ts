/**
 * Import/delete pipeline for emoji packs.
 *
 * Reuses the streaming body reader and browser-mutation checks from the Shiki
 * importer. The file name is always `join(dir, <validated-slug>.json)`, so no
 * user-provided string ever becomes a path. Writes are atomic and never
 * overwrite: builtins and existing packs are rejected with 409 before the
 * temporary file is created.
 */
import { randomBytes } from "node:crypto";
import { linkSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { EmojiPackEntry, EmojiSample, EmojiSamplesPayload } from "../../core/contract";
import { MAX_EMOJI_DATA_URI_BYTES, isEmojiSlug } from "../../core/emoji/constants";
import type { EmojiPack, EmojiPackInfo } from "../../core/emoji/types";
import { emojiPackPath, type EmojiStore } from "../../core/emoji/store";
import { EmojiPackError, validateEmojiPack } from "../../core/emoji/validate";
import { baseHeaders } from "./headers";
import {
  jsonResponse,
  readJsonBody,
  requireMutation,
  ShikiHttpError,
} from "./shiki-import";

export interface EmojiImportDeps {
  dir: string | null;
  store: EmojiStore;
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
  if (err instanceof EmojiPackError) {
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

function entryOf(info: EmojiPackInfo): EmojiPackEntry {
  const out: EmojiPackEntry = {
    name: info.name,
    label: info.label,
    style: info.style,
    source: info.source,
    count: info.count,
  };
  if (info.description !== undefined) out.description = info.description;
  if (info.license !== undefined) out.license = info.license;
  if (info.attribution !== undefined) out.attribution = info.attribution;
  return out;
}

export function emojiEntry(name: string, store: EmojiStore): EmojiPackEntry {
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
    count: Object.keys(pack.shortcodes).length,
  };
}

function writePackFile(dir: string | null, name: string, raw: unknown): void {
  if (!dir) {
    throw new ShikiHttpError(500, "emojis directory is unavailable");
  }
  mkdirSync(dir, { recursive: true });
  const final = emojiPackPath(dir, name);
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
      throw new ShikiHttpError(409, `emoji pack ${name} already exists`);
    }
    throw err;
  } finally {
    unlinkSync(tmp);
  }
}

/** `POST /__emojis`: validates, writes atomically and refreshes the store. */
export async function importEmojiPack(req: Request, deps: EmojiImportDeps): Promise<Response> {
  const forbidden = requireMutation(req, { json: true });
  if (forbidden) {
    return forbidden;
  }
  try {
    const raw = await readJsonBody(req);
    if (!isEmojiSlug((raw as { name?: unknown } | null)?.name)) {
      return textResponse("name must match ^[a-z0-9][a-z0-9-]{0,63}$", 422);
    }
    const name = (raw as { name: string }).name;
    const pack = validateEmojiPack(name, raw);
    const listed = deps.store.list().find((item) => item.name === name);
    if (listed) {
      return textResponse(
        listed.source === "builtin"
          ? `emoji pack ${name} is builtin and cannot be overwritten`
          : `emoji pack ${name} already exists`,
        409
      );
    }
    writePackFile(deps.dir, name, raw);
    deps.store.refresh(true);
    if (!deps.store.has(name)) {
      return textResponse(`emoji pack ${name} could not be loaded after import`, 422);
    }
    return jsonResponse(
      {
        emoji: emojiEntry(name, deps.store),
        emojis: deps.store.list().map(entryOf),
        errors: deps.store.errors(),
      },
      201
    );
  } catch (err) {
    return mapError(err);
  }
}

/** `DELETE /__emojis/<name>`: removes only an imported (user) pack. */
export function deleteEmojiPack(req: Request, name: string, deps: EmojiImportDeps): Response {
  const forbidden = requireMutation(req, { json: false });
  if (forbidden) {
    return forbidden;
  }
  if (!isEmojiSlug(name)) {
    return textResponse("not found", 404);
  }
  const listed = deps.store.list().find((item) => item.name === name);
  if (!listed) {
    return textResponse("not found", 404);
  }
  if (listed.source !== "user") {
    return textResponse(`emoji pack ${name} is builtin and cannot be removed`, 403);
  }
  if (!deps.dir) {
    return textResponse("emojis directory is unavailable", 500);
  }
  try {
    unlinkSync(emojiPackPath(deps.dir, name));
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

/** Shared `GET` payload for the dynamic emoji catalog. */
export function emojisPayload(store: EmojiStore): {
  emojis: EmojiPackEntry[];
  errors: unknown[];
} {
  return { emojis: store.list().map(entryOf), errors: store.errors() };
}

/** Preview grid never needs every shortcode; keep the page payload small. */
export const EMOJI_SAMPLE_COUNT = 24;

/** Total raw bytes allowed for inline SVG data URIs inside one preview. */
export const EMOJI_SAMPLE_MAX_BYTES = 48 * 1024;

/**
 * Picks a bounded, cheap sample of a pack for the settings grid. Inline SVG
 * data URIs over the per-value cap are skipped so a single huge icon cannot
 * dominate the response.
 */
export function emojiSamples(pack: EmojiPack, limit = EMOJI_SAMPLE_COUNT): EmojiSample[] {
  const samples: EmojiSample[] = [];
  let dataBytes = 0;
  for (const [name, value] of Object.entries(pack.shortcodes)) {
    if (samples.length >= limit) {
      break;
    }
    const inline = value.startsWith("data:image/");
    if (inline) {
      const size = Buffer.byteLength(value, "utf8");
      if (size > MAX_EMOJI_DATA_URI_BYTES || dataBytes + size > EMOJI_SAMPLE_MAX_BYTES) {
        continue;
      }
      dataBytes += size;
    }
    samples.push({ name, value });
  }
  return samples;
}

/** `GET /__emoji-samples/<pack>`: lazy preview data for the settings modal. */
export function emojiSamplesResponse(
  name: string,
  store: EmojiStore,
  head = false
): Response {
  if (!isEmojiSlug(name) || !store.has(name)) {
    return new Response(head ? null : "not found", {
      status: 404,
      headers: baseHeaders("text/plain; charset=utf-8"),
    });
  }
  const pack = store.get(name);
  const payload: EmojiSamplesPayload = {
    name: pack.name,
    style: pack.style,
    total: Object.keys(pack.shortcodes).length,
    samples: emojiSamples(pack).map((sample) => ({
      ...sample,
      asset: store.hasAsset(pack.name, sample.name),
    })),
  };
  return new Response(head ? null : JSON.stringify(payload), {
    status: 200,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}
