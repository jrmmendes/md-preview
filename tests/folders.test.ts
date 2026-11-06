import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FOLDER_LIST_LIMIT, listMarkdownFiles } from "../src/core/folders";

function makeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("listMarkdownFiles", () => {
  it("lists only regular Markdown files directly in the folder", () => {
    const dir = makeDir("mdprv-folder-");
    try {
      writeFileSync(join(dir, "b.md"), "# b\n");
      writeFileSync(join(dir, "a.markdown"), "# a\n");
      writeFileSync(join(dir, "c.mdc"), "# c\n");
      writeFileSync(join(dir, "note.txt"), "x\n");
      writeFileSync(join(dir, ".hidden.md"), "# hidden\n");
      mkdirSync(join(dir, "sub"));
      writeFileSync(join(dir, "sub", "nested.md"), "# nested\n");
      const outside = join(dir, "..", `outside-${Date.now()}.md`);
      writeFileSync(outside, "# outside\n");
      try {
        symlinkSync(outside, join(dir, "link.md"));
      } catch {
        /* symlinks unavailable on this platform */
      }

      expect(listMarkdownFiles(dir)).toEqual({
        entries: ["a.markdown", "b.md", "c.mdc"],
        truncated: false,
      });
      rmSync(outside, { force: true });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts names and truncates at the folder limit", () => {
    const dir = makeDir("mdprv-folder-limit-");
    try {
      for (let index = 0; index < FOLDER_LIST_LIMIT + 5; index += 1) {
        writeFileSync(join(dir, `doc-${String(index).padStart(3, "0")}.md`), "# doc\n");
      }
      const listing = listMarkdownFiles(dir);
      expect(listing.entries).toHaveLength(FOLDER_LIST_LIMIT);
      expect(listing.truncated).toBe(true);
      expect(listing.entries[0]).toBe("doc-000.md");
      expect(listing.entries.at(-1)).toBe("doc-199.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty listing for an unreadable folder", () => {
    expect(listMarkdownFiles(join(tmpdir(), `mdprv-missing-${Date.now()}`))).toEqual({
      entries: [],
      truncated: false,
    });
  });
});
