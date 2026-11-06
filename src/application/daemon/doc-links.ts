import { realpathSync, statSync } from "node:fs";
import { resolve, sep } from "node:path";

import { parseDocLink, type DocLinkState } from "../../core/doc-links";
import { isMarkdownPath } from "../../core/extensions";
import { encodeSlugPath } from "../../core/slug";
import type { SlugRegistry } from "./watch";

export interface ResolvedDocFile {
  /** Symlink-resolved absolute path inside the source document folder. */
  path: string;
  /** Decoded sibling file name. */
  name: string;
  /** Raw `?query#fragment` suffix from the link. */
  suffix: string;
}

export interface DocLinkTarget {
  href: string;
  state: DocLinkState;
}

/**
 * Resolve `rel` to a sibling Markdown file of the document `from`.
 *
 * The folder comes from the daemon registry, never from the request. Any
 * failure (unknown slug, invalid name, traversal, symlink escape, missing
 * file, non-Markdown extension) returns `null`.
 */
export function resolveDocFile(
  registry: SlugRegistry,
  from: string,
  rel: string
): ResolvedDocFile | null {
  const entry = registry.get(from);
  if (!entry || !entry.path || !entry.dir) {
    return null;
  }

  const parsed = parseDocLink(rel);
  if (!parsed) {
    return null;
  }

  let root: string;
  try {
    root = realpathSync(entry.dir);
  } catch {
    return null;
  }

  const full = resolve(root, parsed.name);
  if (full !== root && !full.startsWith(root + sep)) {
    return null;
  }

  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return null;
  }
  if (real !== root && !real.startsWith(root + sep)) {
    return null;
  }

  let isFile = false;
  try {
    isFile = statSync(real).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile || !isMarkdownPath(real)) {
    return null;
  }

  return { path: real, name: parsed.name, suffix: parsed.suffix };
}

function withTheme(suffix: string, theme: string | null): string {
  if (!theme) {
    return suffix;
  }
  // A link with its own query keeps it; only fragment-only links gain the theme.
  if (suffix.includes("?")) {
    return suffix;
  }
  return `?theme=${encodeURIComponent(theme)}${suffix}`;
}

/**
 * Build the render-time resolver for links inside `from`.
 *
 * Returns `null` for links that are not relative sibling Markdown documents.
 * Existing registered files point at their slug, existing unregistered files
 * point at `/__doc` (registered on demand) and missing files keep their href
 * plus the `missing` state so the UI can announce the failure.
 */
export function createDocLinkResolver(
  registry: SlugRegistry,
  from: string,
  theme: string | null
): (href: string) => DocLinkTarget | null {
  const entry = registry.get(from);
  if (!entry || !entry.path || !entry.dir) {
    return () => null;
  }

  return (href: string): DocLinkTarget | null => {
    const parsed = parseDocLink(href);
    if (!parsed) {
      return null;
    }

    const resolved = resolveDocFile(registry, from, href);
    if (!resolved) {
      return { href, state: "missing" };
    }

    const suffix = withTheme(parsed.suffix, theme);
    const existing = registry.findByPath(resolved.path);
    if (existing) {
      return { href: "/" + encodeSlugPath(existing) + suffix, state: "registered" };
    }
    return {
      href: `/__doc?from=${encodeURIComponent(from)}&rel=${encodeURIComponent(parsed.name + suffix)}`,
      state: "pending",
    };
  };
}
