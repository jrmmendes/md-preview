import { realpathSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Absolute path with symlinks resolved when possible.
 *
 * Used as the identity of a document so the same file reached through
 * different relative paths or symlinks reuses a single daemon entry.
 */
export function canonicalPath(filePath: string): string {
  const abs = resolve(filePath);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/**
 * What a command-line path currently points at.
 *
 * Symlinks are followed, because `md-preview link-to-dir` must behave like the
 * directory it targets. A path can only name one filesystem entry, so a
 * "file vs directory" ambiguity does not exist: `stat` decides, and a
 * directory named `notes.md` is previewed as a directory.
 */
export type PathKind = "file" | "directory" | "missing" | "other";

export function classifyPath(filePath: string): PathKind {
  try {
    const stats = statSync(resolve(filePath));
    if (stats.isFile()) {
      return "file";
    }
    if (stats.isDirectory()) {
      return "directory";
    }
    return "other";
  } catch {
    return "missing";
  }
}
