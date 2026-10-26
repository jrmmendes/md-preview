import { extname } from "node:path";

/**
 * Extensions accepted by the root command and treated as Markdown.
 *
 * `.mdc` is the Cursor rules format: Markdown with optional YAML frontmatter,
 * rendered exactly like any other Markdown document.
 */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".mdc"] as const;

/** Human readable list used by help and error messages. */
export const MARKDOWN_EXTENSIONS_LABEL = MARKDOWN_EXTENSIONS.join(", ");

const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown|mdc)$/i;

function normalizeExtension(extension: string): string {
  const value = extension.trim().toLowerCase();
  if (value === "") {
    return "";
  }
  return value.startsWith(".") ? value : `.${value}`;
}

export function isMarkdownExtension(extension: string): boolean {
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(normalizeExtension(extension));
}

export function isMarkdownPath(filePath: string): boolean {
  return isMarkdownExtension(extname(filePath));
}

export function stripMarkdownExtension(filePath: string): string {
  return filePath.replace(MARKDOWN_EXTENSION_RE, "");
}
