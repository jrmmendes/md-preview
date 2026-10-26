import { readFileSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import type { SlugInfo } from "../../core/contract";
import { parseFrontmatter } from "../../core/frontmatter";
import { canonicalPath } from "../../core/paths";

export interface SlugEntry {
  path: string;
  /** Symlink-resolved absolute path used as the document identity. */
  realPath: string;
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
  findByPath(rawPath: string): string | null;
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

  function findByPath(rawPath: string): string | null {
    if (!rawPath) {
      return null;
    }
    const target = canonicalPath(rawPath);
    for (const [slug, entry] of slugs) {
      if (entry.realPath === target) {
        return slug;
      }
    }
    return null;
  }

  function register(rawSlug: string, rawPath: string, content: string | null): string {
    const abs = rawPath ? resolve(rawPath) : "";
    const real = abs ? canonicalPath(abs) : "";
    let slug = rawSlug;
    let entry: SlugEntry | undefined;
    let matchedByRealPath = false;

    // Identity is the resolved/real path: the same file reached through a
    // different relative path, symlink or title must reuse the existing entry.
    if (real) {
      const existing = findByPath(real);
      if (existing) {
        slug = existing;
        entry = slugs.get(slug);
        matchedByRealPath = true;
      }
    }

    if (!entry) {
      entry = slugs.get(slug);
      if (entry && abs && entry.realPath !== real) {
        slug = slug + "-" + shortHash(abs);
        entry = slugs.get(slug);
      }
    }

    if (!entry) {
      entry = {
        path: "",
        realPath: "",
        dir: "",
        content: null,
        version: 0,
        watcher: null,
      };
      slugs.set(slug, entry);
    }

    if (abs && !matchedByRealPath) {
      if (entry.path && entry.path !== abs && entry.watcher) {
        entry.watcher.close();
        entry.watcher = null;
      }
      entry.path = abs;
      entry.realPath = real;
      entry.dir = dirname(abs);
    } else if (abs && !entry.realPath) {
      entry.realPath = real;
    }
    if (typeof content === "string") {
      entry.content = content;
    }
    // Re-registering an existing file keeps its tab but still bumps the
    // version, preserving the current reload/live-reload behavior.
    entry.version = (entry.version || 0) + 1;
    callbacks.onVersion?.(slug, entry.version);
    if (entry.path) {
      watchSlug(slug);
    }
    slugs.delete(slug);
    slugs.set(slug, entry);
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
    findByPath,
    get: (slug) => slugs.get(slug),
    entries: () => slugs,
    list,
    close,
  };
}
