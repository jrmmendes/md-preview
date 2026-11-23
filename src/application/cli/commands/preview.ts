import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { loadConfig, type Config } from "../../../core/config";
import { isMarkdownPath } from "../../../core/extensions";
import { canonicalPath } from "../../../core/paths";
import { encodeSlugPath, slugFor } from "../../../core/slug";
import { writePipeDocument, type TempEnv } from "../../../core/temp";
import { inspectContent, MAX_WRAPPED_BYTES } from "../../../core/wrapper";
import { ensureDaemon, registerDocument } from "../daemon-client";
import { present } from "../present";
import { validateThemeOption } from "../theme-option";

export interface PreviewOptions {
  theme?: string;
  /**
   * `undefined` (default) reuses a connected tab and opens the browser only
   * when no tab is connected. `true` always opens, `false` never opens.
   */
  openBrowser?: boolean;
  /** Injection point for tests; defaults to the real platform opener. */
  opener?: (url: string) => boolean;
  /** Injection point for tests; defaults to stdout. */
  log?: (line: string) => void;
}

export interface PreviewResult {
  /** Path as given on the command line. */
  file: string;
  /** Absolute path of the registered document. */
  path: string;
  slug: string;
  url: string;
}

interface PreviewDocument {
  file: string;
  path: string;
  canonical: string;
  slug: string;
  content: string;
}

function loadDocument(file: string): PreviewDocument {
  const abs = resolve(file);
  let isFile = false;
  try {
    isFile = statSync(abs).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    throw new Error(`not a file: ${file}`);
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "unknown";
    throw new Error(`cannot read file: ${file} (${code})`);
  }

  const inspected = isMarkdownPath(abs)
    ? { kind: "text" as const, text: bytes.toString("utf8") }
    : inspectContent(bytes);
  if (inspected.kind === "binary") {
    throw new Error(`binary file: ${file}`);
  }
  if (inspected.kind === "too-large") {
    throw new Error(
      `file too large: ${file} (${inspected.bytes} bytes > ${MAX_WRAPPED_BYTES / (1024 * 1024)} MiB)`
    );
  }

  return {
    file,
    path: abs,
    canonical: canonicalPath(abs),
    slug: slugFor(abs),
    content: inspected.text,
  };
}

function loadDocuments(files: string | readonly string[]): PreviewDocument[] {
  const list = typeof files === "string" ? [files] : [...files];
  if (list.length === 0) {
    throw new Error("no files given");
  }

  const documents: PreviewDocument[] = [];
  const seen = new Set<string>();
  for (const file of list) {
    const document = loadDocument(file);
    // The same file listed twice (or through a symlink) is one tab.
    if (seen.has(document.canonical)) {
      continue;
    }
    seen.add(document.canonical);
    documents.push(document);
  }
  return documents;
}

async function registerDocuments(
  documents: PreviewDocument[],
  options: PreviewOptions,
  config: Config
): Promise<PreviewResult[]> {
  const theme = options.theme ? validateThemeOption(options.theme, config) : undefined;
  const log = options.log ?? ((line: string) => console.log(line));

  const daemon = await ensureDaemon(config);
  const query = theme ? `?theme=${encodeURIComponent(theme)}` : "";
  const results: PreviewResult[] = [];

  for (const document of documents) {
    const finalSlug = await registerDocument(
      daemon.port,
      { slug: document.slug, path: document.path, content: document.content },
      daemon.token
    );
    results.push({
      file: document.file,
      path: document.path,
      slug: finalSlug,
      url: `http://127.0.0.1:${daemon.port}/${encodeSlugPath(finalSlug)}${query}`,
    });
  }

  for (const result of results) {
    log(result.url);
  }

  await present(daemon, results[0]!, { openBrowser: options.openBrowser, opener: options.opener });

  return results;
}

/**
 * Register one or more Markdown files in the daemon.
 *
 * The daemon is started in the background when needed, regardless of the
 * browser flag. By default a connected preview tab is focused and navigated in
 * place; the platform opener is used only for the first run or when no tab is
 * connected. `openBrowser: true` forces opening and `false` suppresses it.
 */
export async function preview(
  files: string | readonly string[],
  options: PreviewOptions = {},
  config: Config = loadConfig()
): Promise<PreviewResult[]> {
  return registerDocuments(loadDocuments(files), options, config);
}

/**
 * Write stdin content to a project-managed temporary `.md` file and register
 * it, so file watching and live reload work like any other document.
 */
export async function previewPipe(
  content: string,
  options: PreviewOptions = {},
  config: Config = loadConfig(),
  env: TempEnv = process.env
): Promise<PreviewResult> {
  if (content.trim() === "") {
    throw new Error("--pipe requires Markdown content on stdin");
  }
  const document = writePipeDocument(content, env);
  const [result] = await registerDocuments(
    [
      {
        file: document.path,
        path: document.path,
        canonical: canonicalPath(document.path),
        slug: document.slug,
        content,
      },
    ],
    options,
    config
  );
  return result!;
}
