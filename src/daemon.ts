import { readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, basename, extname, resolve, sep } from "node:path";

import { mermaidAsset } from "./assets";
import { parseFrontmatter } from "./frontmatter";
import { renderPage } from "./page";
import { normalizeContent, renderMarkdown, warmup } from "./render";
import { clearDaemonState, writeDaemonState } from "./state";
import { resolveThemeName, themeNames } from "./themes";

const DEFAULT_PORT = 8765;
const DEFAULT_IDLE = 15;

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

interface SlugEntry {
  path: string;
  dir: string;
  content: string | null;
  version: number;
  watcher: FSWatcher | null;
}

const slugs = new Map<string, SlugEntry>();

let lastActivity = Date.now();
let stopped = false;
let server: ReturnType<typeof Bun.serve> | undefined;
let idleTimer: ReturnType<typeof setInterval> | undefined;

const port = Number(process.env.MDPRV_PORT) || DEFAULT_PORT;
const idleMs = Math.max(1, (Number(process.env.MDPRV_IDLE) || DEFAULT_IDLE) * 60 * 1000);
const defaultTheme = process.env.MDPRV_THEME || "auto";
const defaultLoader = process.env.MDPRV_LOADER || "classic";
const defaultZoomSensitivity = Number(process.env.MDPRV_ZOOM_SENSITIVITY) || 1.1;

function baseHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    Connection: "close",
  };
}

function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: baseHeaders("text/plain; charset=utf-8") });
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shortHash(value: string): string {
  let h = 0;
  for (const byte of Buffer.from(value, "utf8")) {
    h = (h * 31 + byte) % 4294967296;
  }
  return h.toString(16).padStart(8, "0");
}

function readDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function titleFor(entry: SlugEntry): string {
  let content = entry.content;
  if (content === null || content === undefined) {
    content = entry.path ? readDisk(entry.path) : null;
  }
  if (typeof content === "string") {
    try {
      const { data } = parseFrontmatter(content);
      const raw = data.title;
      if (typeof raw === "string" || typeof raw === "number") {
        const trimmed = String(raw).trim();
        if (trimmed !== "") {
          return trimmed;
        }
      }
    } catch {
      /* malformed frontmatter: fall through to basename */
    }
  }
  if (entry.path) {
    return basename(entry.path);
  }
  return "";
}

function slugList(): Array<{ slug: string; path: string; title: string }> {
  const entries = Array.from(slugs.entries());
  entries.reverse();
  return entries.map(([slug, entry]) => ({
    slug,
    path: entry.path,
    title: titleFor(entry) || slug,
  }));
}

function watchSlug(slug: string): void {
  const entry = slugs.get(slug);
  if (!entry || !entry.path || entry.watcher) {
    return;
  }
  try {
    const watcher = watch(entry.path, () => {
      const current = slugs.get(slug);
      if (current && current.path) {
        const data = readDisk(current.path);
        if (data !== null) {
          current.content = data;
          current.version = (current.version || 0) + 1;
        }
      }
    });
    watcher.on("error", () => {});
    entry.watcher = watcher;
  } catch {
    /* watch unavailable: ignore */
  }
}

function register(rawSlug: string, rawPath: string, content: string | null): string {
  const abs = rawPath ? resolve(rawPath) : "";
  let slug = rawSlug;
  let entry = slugs.get(slug);
  if (entry && abs && entry.path !== abs) {
    slug = slug + "-" + shortHash(abs);
    entry = slugs.get(slug);
  }
  if (!entry) {
    entry = { path: "", dir: "", content: null, version: 0, watcher: null };
    slugs.set(slug, entry);
  }
  if (abs) {
    entry.path = abs;
    entry.dir = dirname(abs);
  }
  if (typeof content === "string") {
    entry.content = content;
  }
  entry.version = (entry.version || 0) + 1;
  if (entry.path) {
    watchSlug(slug);
  }
  slugs.delete(slug);
  slugs.set(slug, entry);
  return slug;
}

async function registerHandler(req: Request): Promise<Response> {
  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return text("bad request", 400);
  }
  const payload = data as { slug?: unknown; path?: unknown; content?: unknown };
  if (!payload || typeof payload.slug !== "string" || payload.slug === "") {
    return text("bad request", 400);
  }
  const filePath = typeof payload.path === "string" ? payload.path : "";
  const content = typeof payload.content === "string" ? payload.content : null;
  return json({ slug: register(payload.slug, filePath, content) });
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) {
      continue;
    }
    if (part.slice(0, idx).trim() === name) {
      return safeDecode(part.slice(idx + 1).trim());
    }
  }
  return null;
}

async function serveSlug(route: string, req: Request, url: URL): Promise<Response> {
  let slug = route.slice(1);
  let versionRoute = false;
  if (slug.endsWith("/version")) {
    slug = slug.slice(0, -"/version".length);
    versionRoute = true;
  }

  const entry = slugs.get(slug);
  if (!entry) {
    return text("not found", 404);
  }
  if (versionRoute) {
    return text(String(entry.version || 0));
  }

  let content = entry.content;
  if (content === null || content === undefined) {
    content = entry.path ? readDisk(entry.path) : null;
    if (content === null) {
      content = "";
    }
  }

  const themeName = resolveThemeName(
    url.searchParams.get("theme"),
    cookieValue(req.headers.get("cookie"), "mdprv_theme"),
    defaultTheme
  );
  const { data, body: markdownBody } = parseFrontmatter(content);
  const metaTitle =
    typeof data.title === "string" || typeof data.title === "number" ? String(data.title).trim() : "";
  const title = metaTitle || (entry.path ? basename(entry.path) : "Markdown Preview");
  const body = await renderMarkdown(normalizeContent(markdownBody), themeName, slug);
  return new Response(renderPage({ title, body, themeName, loader: defaultLoader, zoomSensitivity: defaultZoomSensitivity, meta: data }), {
    headers: baseHeaders("text/html; charset=utf-8"),
  });
}

function serveImage(rel: string): Response {
  let bestSlug = "";
  for (const slug of slugs.keys()) {
    if ((rel === slug || rel.startsWith(slug + "/")) && slug.length > bestSlug.length) {
      bestSlug = slug;
    }
  }
  if (!bestSlug) {
    return text("not found", 404);
  }

  const entry = slugs.get(bestSlug)!;
  const rest = rel.slice(bestSlug.length).replace(/^\//, "");
  if (rest === "" || rest.startsWith("/") || rest.includes("..")) {
    return text("not found", 404);
  }
  const root = entry.dir;
  if (!root) {
    return text("not found", 404);
  }

  const full = resolve(root, rest);
  if (full !== root && !full.startsWith(root + sep)) {
    return text("not found", 404);
  }

  let isFile = false;
  try {
    isFile = statSync(full).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    return text("not found", 404);
  }

  let data: Buffer;
  try {
    data = readFileSync(full);
  } catch {
    return text("not found", 404);
  }
  const ext = extname(full).slice(1).toLowerCase();
  return new Response(data, {
    headers: baseHeaders(IMAGE_TYPES[ext] || "application/octet-stream"),
  });
}

async function handle(req: Request): Promise<Response> {
  lastActivity = Date.now();
  const url = new URL(req.url);
  const route = safeDecode(url.pathname);
  const method = req.method.toUpperCase();

  if ((method === "GET" || method === "HEAD") && route === "/__health") {
    return text("ok");
  }
  if (method === "PUT" && route === "/__register") {
    return registerHandler(req);
  }
  if (method === "POST" && route === "/__shutdown") {
    setTimeout(() => shutdown(0), 50);
    return text("bye");
  }
  if ((method === "GET" || method === "HEAD") && route === "/__themes") {
    return json({ themes: themeNames() });
  }
  if ((method === "GET" || method === "HEAD") && route === "/__slugs") {
    return json({ slugs: slugList() });
  }
  if ((method === "GET" || method === "HEAD") && route === "/__assets/mermaid.min.js") {
    return mermaidAsset();
  }

  if (method === "GET" || method === "HEAD") {
    if (route.startsWith("/img/")) {
      return serveImage(route.slice("/img/".length));
    }
    return serveSlug(route, req, url);
  }

  if (method === "PUT" || method === "POST") {
    return text("not found", 404);
  }
  return text("method not allowed", 405);
}

function shutdown(code: number): void {
  if (stopped) {
    return;
  }
  stopped = true;
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = undefined;
  }
  clearDaemonState();
  try {
    server?.stop(true);
  } catch {
    /* ignore */
  }
  process.exit(code);
}

export function startDaemon(): void {
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: handle,
    });
  } catch (err) {
    process.stderr.write(`md-preview: could not bind 127.0.0.1:${port}: ${String(err)}\n`);
    process.exit(1);
  }

  writeDaemonState(process.pid, port);

  const tick = Math.max(500, Math.min(30000, Math.floor(idleMs / 2)));
  idleTimer = setInterval(() => {
    if (Date.now() - lastActivity > idleMs) {
      shutdown(0);
    }
  }, tick);

  void warmup();
}
