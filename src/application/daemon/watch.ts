import { readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { SlugInfo } from "../../core/contract";
import { parseFrontmatter } from "../../core/frontmatter";

export interface SlugEntry {
  path: string;
  dir: string;
  content: string | null;
  version: number;
  watcher: FSWatcher | null;
}

export interface WatchCallbacks {
  onVersion?: (slug: string, version: number) => void;
  onSlugs?: (slugs: SlugInfo[]) => void;
}

export interface SlugRegistry {
  register(rawSlug: string, rawPath: string, content: string | null): string;
  get(slug: string): SlugEntry | undefined;
  entries(): ReadonlyMap<string, SlugEntry>;
  list(): SlugInfo[];
  close(): void;
}

function shortHash(value: string): string {
  let h = 0;
  for (const byte of Buffer.from(value, "utf8")) {
    h = (h * 31 + byte) % 4294967296;
  }
  return h.toString(16).padStart(8, "0");
}

function readDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function titleFor(entry: SlugEntry): string {
  let content = entry.content;
  if (content === null || content === undefined) {
    content = entry.path ? readDisk(entry.path) : null;
  }
  if (typeof content === "string") {
    try {
      const { data } = parseFrontmatter(content);
      const raw = data.title;
      if (typeof raw === "string" || typeof raw === "number") {
        const trimmed = String(raw).trim();
        if (trimmed !== "") {
          return trimmed;
        }
      }
    } catch {
      /* malformed frontmatter: fall through to basename */
    }
  }
  if (entry.path) {
    return basename(entry.path);
  }
  return "";
}

export function createSlugRegistry(callbacks: WatchCallbacks = {}): SlugRegistry {
  const slugs = new Map<string, SlugEntry>();

  function list(): SlugInfo[] {
    const entries = Array.from(slugs.entries());
    entries.reverse();
    return entries.map(([slug, entry]) => ({
      slug,
      path: entry.path,
      title: titleFor(entry) || slug,
    }));
  }

  function watchSlug(slug: string): void {
    const entry = slugs.get(slug);
    if (!entry || !entry.path || entry.watcher) {
      return;
    }
    try {
      const watcher = watch(entry.path, () => {
        const current = slugs.get(slug);
        if (!current || !current.path) {
          return;
        }
        const before = titleFor(current);
        const data = readDisk(current.path);
        if (data === null) {
          return;
        }
        current.content = data;
        current.version = (current.version || 0) + 1;
        callbacks.onVersion?.(slug, current.version);
        if (titleFor(current) !== before) {
          callbacks.onSlugs?.(list());
        }
      });
      watcher.on("error", () => {});
      entry.watcher = watcher;
    } catch {
      /* watch unavailable: ignore */
    }
  }

  function register(rawSlug: string, rawPath: string, content: string | null): string {
    const abs = rawPath ? resolve(rawPath) : "";
    let slug = rawSlug;
    let entry = slugs.get(slug);
    if (entry && abs && entry.path !== abs) {
      slug = slug + "-" + shortHash(abs);
      entry = slugs.get(slug);
    }
    if (!entry) {
      entry = { path: "", dir: "", content: null, version: 0, watcher: null };
      slugs.set(slug, entry);
    }
    if (abs) {
      entry.path = abs;
      entry.dir = dirname(abs);
    }
    if (typeof content === "string") {
      entry.content = content;
    }
    entry.version = (entry.version || 0) + 1;
    if (entry.path) {
      watchSlug(slug);
    }
    slugs.delete(slug);
    slugs.set(slug, entry);
    callbacks.onVersion?.(slug, entry.version);
    callbacks.onSlugs?.(list());
    return slug;
  }

  function close(): void {
    for (const entry of slugs.values()) {
      entry.watcher?.close();
      entry.watcher = null;
    }
  }

  return {
    register,
    get: (slug) => slugs.get(slug),
    entries: () => slugs,
    list,
    close,
  };
}
