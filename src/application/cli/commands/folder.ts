import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadConfig, type Config } from "../../../core/config";
import {
  MARKDOWN_EXTENSIONS_LABEL,
  stripMarkdownExtension,
} from "../../../core/extensions";
import { FOLDER_LIST_LIMIT, listMarkdownFiles } from "../../../core/folders";
import { encodeSlugPath } from "../../../core/slug";
import { ensureDaemon, registerDocument } from "../daemon-client";
import { present } from "../present";
import { validateThemeOption } from "../theme-option";

export interface FolderOptions {
  /** Theme appended as `?theme=<name>` to every URL. */
  theme?: string;
  /**
   * `undefined` (default) reuses a connected tab and opens the browser only
   * when no tab is connected. `true` always opens, `false` never opens.
   */
  openBrowser?: boolean;
  /** Injection point for tests; defaults to the real platform opener. */
  opener?: (url: string) => boolean;
  /** Injection point for tests; defaults to stdout. */
  log?: (line: string) => void;
}

export interface FolderEntryResult {
  /** File name relative to the folder, never an absolute path. */
  name: string;
  /** Absolute path used to register the document. */
  path: string;
  slug: string;
  url: string;
}

export interface FolderResult {
  /** Absolute folder that was listed. */
  dir: string;
  entries: FolderEntryResult[];
  /** URL handed to the browser: `index.md` when present, else the first name. */
  opened: string;
}

/** File-name slug: keeps sites served from a folder free of absolute paths. */
function slugForName(name: string): string {
  const base = stripMarkdownExtension(name)
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "document";
}

/**
 * Register every Markdown file directly inside a directory and open one
 * preview.
 *
 * `index.md` wins when present; otherwise the first file in alphabetical order
 * is opened. Subfolders, hidden names and symlinks are skipped by
 * `listMarkdownFiles`; output only ever shows relative file names.
 */
export async function previewFolder(
  target: string,
  options: FolderOptions = {},
  config: Config = loadConfig()
): Promise<FolderResult> {
  const dir = resolve(target);
  let isDirectory = false;
  try {
    isDirectory = statSync(dir).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new Error(`not a directory: ${target}`);
  }

  const listing = listMarkdownFiles(dir);
  if (listing.entries.length === 0) {
    throw new Error(
      `no Markdown files (${MARKDOWN_EXTENSIONS_LABEL}) in ${target}`
    );
  }

  const theme = options.theme ? validateThemeOption(options.theme, config) : undefined;
  const query = theme ? `?theme=${encodeURIComponent(theme)}` : "";

  const daemon = await ensureDaemon(config);
  const log = options.log ?? ((line: string) => console.log(line));
  const entries: FolderEntryResult[] = [];

  for (const name of listing.entries) {
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const slug = await registerDocument(
      daemon.port,
      { slug: slugForName(name), path, content },
      daemon.token
    );
    const url = `http://127.0.0.1:${daemon.port}/${encodeSlugPath(slug)}${query}`;
    entries.push({ name, path, slug, url });
    log(`${name}  ${url}`);
  }

  if (listing.truncated) {
    process.stderr.write(
      `md-preview: only the first ${FOLDER_LIST_LIMIT} Markdown files were registered\n`
    );
  }

  const preferred = entries.find((entry) => entry.name === "index.md") ?? entries[0]!;
  await present(daemon, preferred, { openBrowser: options.openBrowser, opener: options.opener });

  return { dir, entries, opened: preferred.url };
}
