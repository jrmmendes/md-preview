import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { loadConfig, type Config } from "../../../core/config";
import { slugFor } from "../../../core/slug";
import { openInBrowser } from "../browser";
import { ensureDaemon, registerDocument } from "../daemon-client";

function encodeSlug(slug: string): string {
  return slug.split("/").map(encodeURIComponent).join("/");
}

export async function preview(file: string, config: Config = loadConfig()): Promise<void> {
  const abs = resolve(file);
  let isFile = false;
  try {
    isFile = statSync(abs).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new Error(`not a file: ${file}`);
  }

  const ext = extname(abs).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    throw new Error(`unsupported file extension: ${ext || "(none)"} (expected .md or .markdown)`);
  }

  const content = readFileSync(abs, "utf8");
  const slug = slugFor(abs);
  const daemon = await ensureDaemon(config);
  const finalSlug = await registerDocument(daemon.port, { slug, path: abs, content });
  const url = `http://127.0.0.1:${daemon.port}/${encodeSlug(finalSlug)}`;

  if (!openInBrowser(url)) {
    process.stderr.write(`md-preview: could not open a browser\n`);
  }
  console.log(url);
}
