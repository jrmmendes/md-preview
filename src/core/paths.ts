import { realpathSync } from "node:fs";
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
