import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

function gitRoot(dir: string): string | null {
  try {
    const result = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--show-toplevel"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
    });
    if (result.exitCode !== 0) {
      return null;
    }
    const root = result.stdout.toString().trim();
    return root === "" ? null : root;
  } catch {
    return null;
  }
}

export function baseRoot(path: string): string {
  const git = gitRoot(dirname(path));
  if (git) {
    return git;
  }
  const home = homedir();
  if (path === home || path.startsWith(home + "/")) {
    return home;
  }
  return "/";
}

export function slugFor(path: string): string {
  let abs = resolve(path);
  abs = abs.replace(/\/+$/, "");
  if (abs === "") {
    abs = "/";
  }

  const root = baseRoot(abs);
  const rel = abs
    .slice(root.length)
    .replace(/\.(md|markdown)$/i, "")
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9/._-]/g, "-")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "");

  return rel || basename(abs);
}
