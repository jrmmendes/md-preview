import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const PIPE_FILE_PREFIX = "temp-";

export type TempEnv = Record<string, string | undefined>;

export interface PipeDocument {
  /** Absolute path written to disk. */
  path: string;
  /** Registered slug: the basename including the `.md` extension. */
  slug: string;
  /** Basename including the `.md` extension. */
  name: string;
}

/**
 * Project-managed directory for piped documents.
 *
 * It lives under the XDG cache directory so the daemon can watch the file
 * without mixing it with user documents. `MDPRV_TMP_DIR` overrides it for
 * portable installs and tests.
 */
export function resolveTempDir(env: TempEnv = process.env): string {
  if (env.MDPRV_TMP_DIR) {
    return resolve(env.MDPRV_TMP_DIR);
  }
  const base = env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return resolve(base, "md-preview", "tmp");
}

export function writePipeDocument(content: string, env: TempEnv = process.env): PipeDocument {
  const dir = resolveTempDir(env);
  mkdirSync(dir, { recursive: true });
  const name = `${PIPE_FILE_PREFIX}${randomUUID()}.md`;
  const filePath = join(dir, name);
  writeFileSync(filePath, content, { mode: 0o600 });
  return {
    path: filePath,
    slug: name,
    name,
  };
}
