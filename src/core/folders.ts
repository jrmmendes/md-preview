import { readdirSync } from "node:fs";

import { isMarkdownPath } from "./extensions";

/** Maximum number of entries returned by a folder listing. */
export const FOLDER_LIST_LIMIT = 200;

export interface FolderListing {
  /** Markdown file names directly inside the folder, sorted. */
  entries: string[];
  /** True when the folder has more Markdown files than the limit. */
  truncated: boolean;
}

/**
 * List regular Markdown files directly inside `dir`.
 *
 * Hidden names, subdirectories and symlinks are skipped. Unreadable folders
 * produce an empty, non-truncated listing so the caller can report it.
 */
export function listMarkdownFiles(dir: string): FolderListing {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && isMarkdownPath(entry.name))
      .map((entry) => entry.name);
  } catch {
    return { entries: [], truncated: false };
  }
  names.sort((a, b) => a.localeCompare(b));
  return {
    entries: names.slice(0, FOLDER_LIST_LIMIT),
    truncated: names.length > FOLDER_LIST_LIMIT,
  };
}
