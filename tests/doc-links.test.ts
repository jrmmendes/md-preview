import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocLinkResolver, resolveDocFile } from "../src/application/daemon/doc-links";
import { createSlugRegistry, type SlugRegistry } from "../src/application/daemon/watch";
import { isPlainDocLinkActivation, parseDocLink } from "../src/core/doc-links";

const dir = mkdtempSync(join(tmpdir(), "mdprv-doc-links-"));
const fileA = join(dir, "a.md");
const fileB = join(dir, "b.md");
writeFileSync(fileA, "# A\n");
writeFileSync(fileB, "# B\n");

const registry: SlugRegistry = createSlugRegistry();
registry.register("docs/a", fileA, null);

afterAll(() => {
  registry.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("parseDocLink", () => {
  it("accepts sibling Markdown links", () => {
    expect(parseDocLink("outro.md")).toEqual({ name: "outro.md", suffix: "" });
    expect(parseDocLink("./outro.md")).toEqual({ name: "outro.md", suffix: "" });
    expect(parseDocLink("outro.markdown")).toEqual({ name: "outro.markdown", suffix: "" });
    expect(parseDocLink("outro.mdc")).toEqual({ name: "outro.mdc", suffix: "" });
    expect(parseDocLink("OUTRO.MD")).toEqual({ name: "OUTRO.MD", suffix: "" });
    expect(parseDocLink("caf%C3%A9.md")).toEqual({ name: "café.md", suffix: "" });
  });

  it("preserves query and fragment order", () => {
    expect(parseDocLink("outro.md?x=1#sec")).toEqual({
      name: "outro.md",
      suffix: "?x=1#sec",
    });
    expect(parseDocLink("outro.md#sec")).toEqual({ name: "outro.md", suffix: "#sec" });
    expect(parseDocLink("./outro.mdc?theme=nord")).toEqual({
      name: "outro.mdc",
      suffix: "?theme=nord",
    });
  });

  it("rejects non-document and out-of-folder links", () => {
    for (const href of [
      "",
      "#sec",
      "https://example.com/outro.md",
      "mailto:dev@example.com",
      "//example.com/outro.md",
      "/outro.md",
      "\\outro.md",
      "sub/outro.md",
      "../outro.md",
      "./sub/outro.md",
      "..%2Foutro.md",
      "sub%2Foutro.md",
      "..",
      ".",
      "outro",
      "outro.txt",
      "outro.md%00",
      "%E0%A4%A.md",
    ]) {
      expect(parseDocLink(href)).toBeNull();
    }
  });
});

describe("resolveDocFile", () => {
  it("resolves an existing sibling file", () => {
    expect(resolveDocFile(registry, "docs/a", "b.md")).toEqual({
      path: fileB,
      name: "b.md",
      suffix: "",
    });
    expect(resolveDocFile(registry, "docs/a", "b.md?x=1#sec")).toEqual({
      path: fileB,
      name: "b.md",
      suffix: "?x=1#sec",
    });
  });

  it("rejects unknown slugs, traversal, absolute paths and symlink escapes", () => {
    expect(resolveDocFile(registry, "unknown", "b.md")).toBeNull();
    expect(resolveDocFile(registry, "docs/a", "../a.md")).toBeNull();
    expect(resolveDocFile(registry, "docs/a", "/tmp/b.md")).toBeNull();
    expect(resolveDocFile(registry, "docs/a", "missing.md")).toBeNull();
    expect(resolveDocFile(registry, "docs/a", "b.txt")).toBeNull();

    const outside = join(tmpdir(), `mdprv-doc-links-outside-${Date.now()}.md`);
    writeFileSync(outside, "# Outside\n");
    try {
      try {
        symlinkSync(outside, join(dir, "escape.md"));
        expect(resolveDocFile(registry, "docs/a", "escape.md")).toBeNull();
      } catch {
        /* symlinks unavailable on this platform */
      }
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

describe("createDocLinkResolver", () => {
  it("points registered files at their slug", () => {
    const resolve = createDocLinkResolver(registry, "docs/a", null);
    expect(resolve("a.md")).toEqual({ href: "/docs/a", state: "registered" });
    expect(resolve("./a.md?x=1#sec")).toEqual({
      href: "/docs/a?x=1#sec",
      state: "registered",
    });
  });

  it("routes unregistered files through /__doc", () => {
    const resolve = createDocLinkResolver(registry, "docs/a", null);
    expect(resolve("b.md")).toEqual({
      href: "/__doc?from=docs%2Fa&rel=b.md",
      state: "pending",
    });
  });

  it("propagates the explicit theme only when the link has no query", () => {
    const resolve = createDocLinkResolver(registry, "docs/a", "nord");
    expect(resolve("b.md")).toEqual({
      href: "/__doc?from=docs%2Fa&rel=b.md%3Ftheme%3Dnord",
      state: "pending",
    });
    expect(resolve("b.md#sec")).toEqual({
      href: "/__doc?from=docs%2Fa&rel=b.md%3Ftheme%3Dnord%23sec",
      state: "pending",
    });
    expect(resolve("b.md?x=1")).toEqual({
      href: "/__doc?from=docs%2Fa&rel=b.md%3Fx%3D1",
      state: "pending",
    });
    expect(resolve("a.md?x=1")).toEqual({ href: "/docs/a?x=1", state: "registered" });
  });

  it("marks missing documents and leaves non-document links alone", () => {
    const resolve = createDocLinkResolver(registry, "docs/a", null);
    expect(resolve("missing.md")).toEqual({ href: "missing.md", state: "missing" });
    expect(resolve("../missing.md")).toBeNull();
    expect(resolve("sub/missing.md")).toBeNull();
    expect(resolve("https://example.com/missing.md")).toBeNull();
    expect(resolve("#anchor")).toBeNull();
  });

  it("does nothing for a document without a folder", () => {
    const contentOnly = createSlugRegistry();
    try {
      contentOnly.register("pipe-doc", "", "# Piped\n");
      expect(createDocLinkResolver(contentOnly, "pipe-doc", null)("a.md")).toBeNull();
    } finally {
      contentOnly.close();
    }
  });
});

describe("isPlainDocLinkActivation", () => {
  const link = { target: null, hasDownload: false };

  it("accepts primary clicks without modifiers", () => {
    expect(isPlainDocLinkActivation(link, {})).toBe(true);
    expect(isPlainDocLinkActivation({ target: "_self" }, { button: 0 })).toBe(true);
  });

  it("rejects modified, non-primary, download and new-tab clicks", () => {
    expect(isPlainDocLinkActivation(link, { ctrlKey: true })).toBe(false);
    expect(isPlainDocLinkActivation(link, { metaKey: true })).toBe(false);
    expect(isPlainDocLinkActivation(link, { shiftKey: true })).toBe(false);
    expect(isPlainDocLinkActivation(link, { altKey: true })).toBe(false);
    expect(isPlainDocLinkActivation(link, { button: 1 })).toBe(false);
    expect(isPlainDocLinkActivation(link, { defaultPrevented: true })).toBe(false);
    expect(isPlainDocLinkActivation({ hasDownload: true }, {})).toBe(false);
    expect(isPlainDocLinkActivation({ target: "_blank" }, {})).toBe(false);
  });
});
