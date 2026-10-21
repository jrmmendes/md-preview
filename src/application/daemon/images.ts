import { readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

import type { SlugEntry } from "./watch";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function headers(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    Connection: "close",
  };
}

function notFound(): Response {
  return new Response("not found", { status: 404, headers: headers("text/plain; charset=utf-8") });
}

export function serveImage(rel: string, slugs: ReadonlyMap<string, SlugEntry>): Response {
  let bestSlug = "";
  for (const slug of slugs.keys()) {
    if ((rel === slug || rel.startsWith(slug + "/")) && slug.length > bestSlug.length) {
      bestSlug = slug;
    }
  }
  if (!bestSlug) {
    return notFound();
  }

  const entry = slugs.get(bestSlug);
  if (!entry) {
    return notFound();
  }
  const rest = rel.slice(bestSlug.length).replace(/^\//, "");
  if (rest === "" || rest.startsWith("/") || rest.includes("..")) {
    return notFound();
  }
  const root = entry.dir;
  if (!root) {
    return notFound();
  }

  const full = resolve(root, rest);
  if (full !== root && !full.startsWith(root + sep)) {
    return notFound();
  }

  let isFile = false;
  try {
    isFile = statSync(full).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return notFound();
  }

  let data: Buffer;
  try {
    data = readFileSync(full);
  } catch {
    return notFound();
  }
  const ext = extname(full).slice(1).toLowerCase();
  return new Response(data, {
    headers: headers(IMAGE_TYPES[ext] || "application/octet-stream"),
  });
}
