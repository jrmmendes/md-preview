import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { baseRoot, slugFor } from "../src/core/slug";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-slug-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("baseRoot", () => {
  it("uses the git root of the file", () => {
    const dir = tempDir();
    const result = Bun.spawnSync(["git", "init"], { cwd: dir, stdout: "ignore", stderr: "ignore" });
    expect(result.exitCode).toBe(0);
    const nested = join(dir, "docs");
    mkdirSync(nested);
    const file = join(nested, "note.md");
    writeFileSync(file, "# note\n");
    expect(baseRoot(file)).toBe(dir);
  });

  it("uses the home directory for paths under home", () => {
    expect(baseRoot(join(homedir(), "mdprv-slug-test.md"))).toBe(homedir());
  });

  it("falls back to the filesystem root", () => {
    expect(baseRoot("/etc/mdprv-slug-test.md")).toBe("/");
  });
});

describe("slugFor", () => {
  it("removes the extension and normalizes spaces and invalid characters", () => {
    const dir = tempDir();
    const file = join(dir, "My Note @ home.md");
    writeFileSync(file, "# note\n");
    const slug = slugFor(file);
    expect(slug).not.toContain(".md");
    expect(slug.endsWith("My-Note---home")).toBe(true);
  });

  it("supports .markdown and relative paths", () => {
    const dir = tempDir();
    const file = join(dir, "sub", "note.markdown");
    mkdirSync(join(dir, "sub"));
    writeFileSync(file, "# note\n");
    expect(slugFor(file).endsWith("sub/note")).toBe(true);
    expect(slugFor(file)).toBe(slugFor(file));
  });

  it("handles the filesystem root", () => {
    expect(slugFor("/")).toBe("");
  });
});
