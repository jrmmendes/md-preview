import { describe, expect, it } from "bun:test";

import {
  buildWrapperMarkdown,
  fenceFor,
  inspectContent,
  languageForFile,
  MAX_WRAPPED_BYTES,
  previewSourceFor,
} from "../src/core/wrapper";

describe("languageForFile", () => {
  it("maps common extensions case-insensitively", () => {
    expect(languageForFile("data.json")).toBe("json");
    expect(languageForFile("conf.YML")).toBe("yaml");
    expect(languageForFile("script.TS")).toBe("typescript");
    expect(languageForFile("a.tsx")).toBe("tsx");
    expect(languageForFile("a.js")).toBe("javascript");
    expect(languageForFile("a.py")).toBe("python");
    expect(languageForFile("run.sh")).toBe("bash");
    expect(languageForFile("README.md")).toBe("markdown");
    expect(languageForFile("a.mdx")).toBe("mdx");
    expect(languageForFile("x.csv")).toBe("csv");
    expect(languageForFile("x.toml")).toBe("toml");
    expect(languageForFile("x.ini")).toBe("ini");
    expect(languageForFile("x.html")).toBe("html");
    expect(languageForFile("x.css")).toBe("css");
    expect(languageForFile("x.sql")).toBe("sql");
    expect(languageForFile("x.go")).toBe("go");
    expect(languageForFile("x.rs")).toBe("rust");
    expect(languageForFile("x.lua")).toBe("lua");
    expect(languageForFile("x.svg")).toBe("xml");
  });

  it("maps well-known file names without extensions", () => {
    expect(languageForFile("Dockerfile")).toBe("dockerfile");
    expect(languageForFile("Dockerfile.dev")).toBe("dockerfile");
    expect(languageForFile("Makefile")).toBe("makefile");
    expect(languageForFile("GNUmakefile")).toBe("makefile");
    expect(languageForFile("CMakeLists.txt")).toBe("cmake");
    expect(languageForFile("Jenkinsfile")).toBe("groovy");
    expect(languageForFile("go.mod")).toBe("go");
    expect(languageForFile(".gitignore")).toBe("gitignore");
  });

  it("falls back to text for unknown names", () => {
    expect(languageForFile("LICENSE")).toBe("text");
    expect(languageForFile("file.unknownext")).toBe("text");
    expect(languageForFile(".env")).toBe("dotenv");
  });
});

describe("fenceFor", () => {
  it("uses three backticks by default", () => {
    expect(fenceFor("plain")).toBe("```");
    expect(fenceFor("")).toBe("```");
  });

  it("grows past the longest run of backticks in the content", () => {
    expect(fenceFor("```")).toBe("````");
    expect(fenceFor("````")).toBe("`````");
    expect(fenceFor("a `` b ``` c")).toBe("````");
  });
});

describe("buildWrapperMarkdown", () => {
  it("wraps content in a single fence", () => {
    expect(buildWrapperMarkdown("a\n", "text")).toBe("```text\na\n```\n");
    expect(buildWrapperMarkdown("a", "text")).toBe("```text\na\n```\n");
    expect(buildWrapperMarkdown("", "text")).toBe("```text\n```\n");
    expect(buildWrapperMarkdown("a\r\n", "text")).toBe("```text\na\r\n```\n");
  });

  it("uses a longer fence when the content contains backticks", () => {
    expect(buildWrapperMarkdown("```json\n{}\n```\n", "json")).toBe(
      "````json\n```json\n{}\n```\n````\n"
    );
  });
});

describe("previewSourceFor", () => {
  it("keeps Markdown content and path-less content untouched", () => {
    expect(previewSourceFor("notes.md", "# Title\n")).toEqual({
      markdown: "# Title\n",
      language: "",
      wrapped: false,
      previewable: true,
    });
    expect(previewSourceFor("", "# Title\n")).toEqual({
      markdown: "# Title\n",
      language: "",
      wrapped: false,
      previewable: true,
    });
  });

  it("wraps non-Markdown text with the detected language", () => {
    const source = previewSourceFor("data.json", '{"answer":42}\n');
    expect(source.wrapped).toBe(true);
    expect(source.previewable).toBe(true);
    expect(source.language).toBe("json");
    expect(source.markdown).toBe('```json\n{"answer":42}\n```\n');
  });

  it("does not treat a leading --- as frontmatter for non-Markdown", () => {
    const source = previewSourceFor("notes.txt", "---\ntitle: x\n---\n");
    expect(source.wrapped).toBe(true);
    expect(source.markdown).toContain("---\ntitle: x\n---");
  });

  it("wraps an empty non-Markdown file with an empty fence", () => {
    const source = previewSourceFor("empty.txt", "");
    expect(source.wrapped).toBe(true);
    expect(source.markdown).toBe("```text\n```\n");
  });

  it("refuses binary and oversized content", () => {
    expect(previewSourceFor("photo.png", "a\0b").previewable).toBe(false);
    expect(previewSourceFor("huge.log", "a".repeat(MAX_WRAPPED_BYTES + 1)).previewable).toBe(
      false
    );
  });
});

describe("inspectContent", () => {
  const encoder = new TextEncoder();

  it("decodes valid UTF-8 text", () => {
    expect(inspectContent(encoder.encode("olá, ação\n"))).toEqual({
      kind: "text",
      text: "olá, ação\n",
    });
  });

  it("detects NUL bytes as binary", () => {
    expect(inspectContent(Uint8Array.of(0x61, 0x00, 0x62))).toEqual({ kind: "binary" });
  });

  it("detects invalid UTF-8 as binary", () => {
    expect(inspectContent(Uint8Array.of(0xff, 0xfe))).toEqual({ kind: "binary" });
  });

  it("reports the size limit before inspecting the bytes", () => {
    const bytes = new Uint8Array(MAX_WRAPPED_BYTES + 1);
    expect(inspectContent(bytes)).toEqual({ kind: "too-large", bytes: MAX_WRAPPED_BYTES + 1 });
  });
});
