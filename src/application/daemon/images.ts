import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";

import { baseHeaders } from "./headers";
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

function notFound(): Response {
  return new Response("not found", {
    status: 404,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
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
  if (rest === "" || rest.startsWith("/") || rest.includes("..") || rest.includes("\0")) {
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

  let realRoot: string;
  let realFull: string;
  try {
    realRoot = realpathSync(root);
    realFull = realpathSync(full);
  } catch {
    return notFound();
  }
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) {
    return notFound();
  }

  const ext = extname(realFull).slice(1).toLowerCase();
  const contentType = IMAGE_TYPES[ext];
  if (!contentType) {
    return notFound();
  }

  let isFile = false;
  try {
    isFile = statSync(realFull).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return notFound();
  }

  let data: Buffer;
  try {
    data = readFileSync(realFull);
  } catch {
    return notFound();
  }
  return new Response(data, {
    headers: baseHeaders(contentType),
  });
}
