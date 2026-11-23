import { basename, extname } from "node:path";

import { isMarkdownPath } from "./extensions";

/**
 * Maximum size of a non-Markdown file that is shown as a single code fence.
 *
 * Shiki tokenizes the whole block, the generated HTML carries the tokens and
 * the raw view carries the original content too, so the cost is paid three
 * times. Markdown documents keep the previous, unlimited behavior.
 */
export const MAX_WRAPPED_BYTES = 1024 * 1024;

/** Language used when the file name gives no better hint. */
export const FALLBACK_LANGUAGE = "text";

/** Languages inferred from the file extension (keys without the dot). */
export const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  mdc: "markdown",
  mdx: "mdx",
  csv: "csv",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  xml: "xml",
  svg: "xml",
  sql: "sql",
  go: "go",
  rs: "rust",
  lua: "lua",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  php: "php",
  rb: "ruby",
  swift: "swift",
  cs: "csharp",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  diff: "diff",
  patch: "diff",
  txt: "text",
  log: "text",
  env: "dotenv",
  proto: "proto",
  graphql: "graphql",
  gql: "graphql",
  vue: "vue",
  svelte: "svelte",
  r: "r",
  tex: "tex",
  scala: "scala",
  ex: "elixir",
  exs: "elixir",
};

/** Languages inferred from an exact file name (keys are lowercase basenames). */
export const LANGUAGE_BY_FILENAME: Readonly<Record<string, string>> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  jenkinsfile: "groovy",
  gemfile: "ruby",
  rakefile: "ruby",
  podfile: "ruby",
  "go.mod": "go",
  "go.sum": "go",
  "cargo.lock": "toml",
  ".gitignore": "gitignore",
  ".dockerignore": "gitignore",
  ".npmignore": "gitignore",
  ".editorconfig": "ini",
  ".env": "dotenv",
};

/**
 * Best-effort language label for a file that is shown as a code fence.
 * Never throws: unknown names fall back to plain text.
 */
export function languageForFile(filePath: string): string {
  const name = basename(filePath).toLowerCase();
  const special = LANGUAGE_BY_FILENAME[name];
  if (special) {
    return special;
  }
  if (name.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  const extension = extname(name).slice(1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? FALLBACK_LANGUAGE;
}

/**
 * Shortest fence that safely wraps `content`: one backtick longer than the
 * longest run of backticks inside it, never shorter than three.
 */
export function fenceFor(content: string): string {
  let longest = 0;
  for (const match of content.matchAll(/`+/g)) {
    longest = Math.max(longest, match[0].length);
  }
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Markdown source that displays `content` as a single fenced code block.
 *
 * The file content is preserved byte for byte; only a trailing newline is
 * added when missing so the closing fence starts on its own line.
 */
export function buildWrapperMarkdown(content: string, language: string): string {
  const fence = fenceFor(content);
  if (content === "") {
    return `${fence}${language}\n${fence}\n`;
  }
  const trailing = content.endsWith("\n") ? "" : "\n";
  return `${fence}${language}\n${content}${trailing}${fence}\n`;
}

export type InspectedContent =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | { kind: "too-large"; bytes: number };

/**
 * Decide whether raw bytes can be shown as text.
 *
 * NUL bytes and invalid UTF-8 mark a binary file; the size limit is checked
 * first so an oversized file is reported as such even when it is also binary.
 */
export function inspectContent(bytes: Uint8Array): InspectedContent {
  if (bytes.byteLength > MAX_WRAPPED_BYTES) {
    return { kind: "too-large", bytes: bytes.byteLength };
  }
  if (bytes.includes(0)) {
    return { kind: "binary" };
  }
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    return { kind: "text", text: decoder.decode(bytes) };
  } catch {
    return { kind: "binary" };
  }
}

export interface PreviewSource {
  /** Markdown to render (the original document or the synthetic fence). */
  markdown: string;
  /** Fence language; "" for Markdown documents. */
  language: string;
  /** true when the document is displayed as a single code block. */
  wrapped: boolean;
  /** false for binary/oversized content: the caller must refuse it. */
  previewable: boolean;
}

/**
 * Markdown to render for a registered document.
 *
 * A path is the only source of the file type: content registered without a
 * path (stdin/pipe) is treated as Markdown, exactly as before. Markdown paths
 * keep their content untouched; every other text file becomes one fence.
 */
export function previewSourceFor(filePath: string, content: string): PreviewSource {
  if (filePath === "" || isMarkdownPath(filePath)) {
    return { markdown: content, language: "", wrapped: false, previewable: true };
  }
  if (content.includes("\0") || Buffer.byteLength(content, "utf8") > MAX_WRAPPED_BYTES) {
    return { markdown: "", language: "", wrapped: false, previewable: false };
  }
  const language = languageForFile(filePath);
  return {
    markdown: buildWrapperMarkdown(content, language),
    language,
    wrapped: true,
    previewable: true,
  };
}
