import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { loadConfig, type Config } from "../../../core/config";
import {
  isMarkdownExtension,
  MARKDOWN_EXTENSIONS_LABEL,
} from "../../../core/extensions";
import { canonicalPath } from "../../../core/paths";
import { slugFor } from "../../../core/slug";
import { writePipeDocument, type TempEnv } from "../../../core/temp";
import { themesDir } from "../../../core/config-file";
import { createThemeStore } from "../../../core/themes/store";
import { openInBrowser } from "../browser";
import { ensureDaemon, registerDocument } from "../daemon-client";

function encodeSlug(slug: string): string {
  return slug.split("/").map(encodeURIComponent).join("/");
}

export interface PreviewOptions {
  theme?: string;
  /** Open the browser once, with the first file active. Off by default. */
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

function validateThemeOption(theme: string, config: Config): string {
  const store = createThemeStore({
    dir: themesDir(config.configDir),
    watch: false,
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
  if (!store.has(theme)) {
    throw new Error(`unknown theme: ${theme}`);
  }
  return theme;
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

  const ext = extname(abs).toLowerCase();
  if (!isMarkdownExtension(ext)) {
    throw new Error(
      `unsupported file extension: ${ext || "(none)"} (expected ${MARKDOWN_EXTENSIONS_LABEL})`
    );
  }

  return {
    file,
    path: abs,
    canonical: canonicalPath(abs),
    slug: slugFor(abs),
    content: readFileSync(abs, "utf8"),
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
      url: `http://127.0.0.1:${daemon.port}/${encodeSlug(finalSlug)}${query}`,
    });
  }

  for (const result of results) {
    log(result.url);
  }

  if (options.openBrowser) {
    const opener = options.opener ?? openInBrowser;
    if (!opener(results[0]!.url)) {
      process.stderr.write(`md-preview: could not open a browser\n`);
    }
  }

  return results;
}

/**
 * Register one or more Markdown files in the daemon.
 *
 * The daemon is started in the background when needed, regardless of the
 * browser flag. The browser is only opened when `openBrowser` is true, once,
 * after every file has been registered, with the first file active.
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
