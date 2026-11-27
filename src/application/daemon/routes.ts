import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import { configEmojisDir, configFile, configIconsDir, configThemesDir, type Config } from "../../core/config";
import type {
  ActivateEvent,
  PageConfigPayload,
  SnapshotEvent,
} from "../../core/contract";
import { resolveEmojiPackName } from "../../core/emoji/resolve";
import type { EmojiStore } from "../../core/emoji/store";
import { resolveIconPackName } from "../../core/icons/resolve";
import type { IconStore } from "../../core/icons/store";
import { renderPage } from "../../core/page";
import { normalizeContent, renderMarkdown } from "../../core/markdown/render";
import {
  codeToHtmlSingle,
  codeToHtmlWithPair,
  prepareShikiPair,
  warmup,
} from "../../core/markdown/highlight";
import { encodeSlugPath, slugFor } from "../../core/slug";
import { themeCss } from "../../core/themes/css";
import { themeCatalog } from "../../core/themes/catalog";
import { applyThemeOverrides } from "../../core/themes/overrides";
import {
  isKnownMermaidTheme,
  mermaidThemeEntries,
} from "../../core/themes/mermaid-index";
import type { MermaidThemeStore } from "../../core/themes/mermaid-store";
import { resolveThemeName } from "../../core/themes/resolve";
import { isKnownShikiTheme } from "../../core/themes/shiki-index";
import type { ShikiThemeStore } from "../../core/themes/shiki-store";
import type { ThemeStore } from "../../core/themes/store";
import {
  parseThemePrefs,
  THEME_PREFS_COOKIE,
  type ThemePrefs,
} from "../../shared/theme-prefs";
import { VERSION } from "../../core/version";
import { parseFrontmatter } from "../../core/frontmatter";
import { isMarkdownPath } from "../../core/extensions";
import { languageForFile, previewSourceFor } from "../../core/wrapper";
import { mermaidAsset } from "./assets";
import { createDocLinkResolver, resolveDocFile } from "./doc-links";
import { createFontCatalog, type FontCatalog } from "./fonts";
import { baseHeaders, fontAssetHeaders, SECURITY_HEADERS } from "./headers";
import { serveImage } from "./images";
import {
  CODE_PREVIEW_SAMPLE,
  deleteShikiTheme,
  importShikiTheme,
  previewShikiImport,
  shikiThemesPayload,
} from "./shiki-import";
import { deleteColorTheme, importColorTheme } from "./theme-import";
import { deleteMermaidTheme, importMermaidTheme } from "./mermaid-import";
import {
  deleteEmojiPack,
  emojiSamplesResponse,
  emojisPayload,
  importEmojiPack,
} from "./emoji-import";
import { serveEmojiAsset } from "./emoji-assets";
import { serveIconAsset } from "./icons-assets";
import { deleteIconPack, iconsPayload, importIconPack } from "./icons-import";
import { loadShell } from "./shell";
import type { SlugEntry, SlugRegistry } from "./watch";

const CLIENT_TYPES: Record<string, string> = {
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

const DEFAULT_HEARTBEAT_MS = 20_000;

/**
 * After an opener hand-off the tab needs a moment to connect. Repeat CLI calls
 * during this window wait instead of opening a duplicate tab.
 */
const ACTIVATE_GRACE_MS = 6_000;
const ACTIVATE_WAIT_MS = 1_200;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

type SseController = ReadableStreamDefaultController<Uint8Array>;

export interface RouteDeps {
  config: Config;
  themes: ThemeStore;
  shikiThemes: ShikiThemeStore;
  mermaidThemes: MermaidThemeStore;
  emojis: EmojiStore;
  icons: IconStore;
  registry: SlugRegistry;
  token: string;
  onActivity: () => void;
  requestShutdown: () => void;
  heartbeatMs?: number;
  fonts?: FontCatalog;
  /** Per-daemon-session record of opener hand-offs. */
  browser: BrowserSession;
}

/**
 * What the daemon remembers about opening the platform browser.
 *
 * `openedAt` is only used to wait briefly for a freshly opened tab to connect
 * before deciding that another opener call is needed.
 */
export interface BrowserSession {
  readonly opened: boolean;
  readonly openedAt: number | null;
  markOpened(url: string): void;
}

export interface RoutesHandle {
  handle(req: Request): Promise<Response>;
  broadcast(event: string, data: unknown): void;
  close(): void;
}

function hostnameIsLoopback(authority: string): boolean {
  let host = authority.trim().toLowerCase();
  if (host === "") {
    return false;
  }
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end < 0) {
      return false;
    }
    host = host.slice(1, end);
  } else {
    const colon = host.lastIndexOf(":");
    if (colon >= 0) {
      host = host.slice(0, colon);
    }
  }
  return LOOPBACK_HOSTS.has(host);
}

function hostAllowed(req: Request): boolean {
  const host = req.headers.get("host");
  return host !== null && hostnameIsLoopback(host);
}

function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  return url.protocol === "http:" && hostnameIsLoopback(url.host);
}

/** Reject cross-site browser requests that carry `Sec-Fetch-Site`. */
function fetchSiteAllowed(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === null) {
    return true;
  }
  const value = site.trim().toLowerCase();
  return value === "same-origin" || value === "none";
}

/** When an `Origin` is present, require it to match the `Host` exactly. */
function sameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) {
    return true;
  }
  const host = req.headers.get("host");
  if (!host) {
    return false;
  }
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && url.host === host;
  } catch {
    return false;
  }
}

function tokenMatches(req: Request, expected: string): boolean {
  const given = req.headers.get("x-mdprv-token");
  if (!given) {
    return false;
  }
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function addNonce(shell: string, nonce: string): string {
  return shell
    .replace(/<script(?=[\s>])/gi, `<script nonce="${nonce}"`)
    .replace(/<style(?=[\s>])/gi, `<style nonce="${nonce}"`);
}

function text(body: string, status = 200, head = false): Response {
  return new Response(head ? null : body, {
    status,
    headers: baseHeaders("text/plain; charset=utf-8"),
  });
}

function json(value: unknown, status = 200, head = false): Response {
  return new Response(head ? null : JSON.stringify(value), {
    status,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

function css(body: string, head = false): Response {
  return new Response(head ? null : body, {
    headers: baseHeaders("text/css; charset=utf-8"),
  });
}

function fontFile(data: Uint8Array, head = false): Response {
  return new Response(head ? null : data, {
    headers: fontAssetHeaders(),
  });
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readDisk(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/** Registered content when available, otherwise the current file on disk. */
function entryContent(entry: SlugEntry): string {
  let content = entry.content;
  if (content === null || content === undefined) {
    content = entry.path ? readDisk(entry.path) : null;
    if (content === null) {
      content = "";
    }
  }
  return content;
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

/** Read-only daemon settings for the settings modal's System page. */
function pageConfig(config: Config): PageConfigPayload {
  return {
    port: config.port,
    idleMinutes: Math.max(1, Math.round(config.idleMs / 60000)),
    seedThemes: config.seedThemes,
    paths: {
      config: configFile(config),
      themes: configThemesDir(config),
      emojis: configEmojisDir(config),
      icons: configIconsDir(config),
      state: config.stateFile,
    },
  };
}

/** Common language aliases accepted by the code preview endpoint. */
const LANG_ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  yml: "yaml",
  sh: "bash",
  shell: "bash",
  py: "python",
  rb: "ruby",
};

function previewLanguage(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") {
    return "typescript";
  }
  const value = raw.trim().toLowerCase();
  if (value === "text" || value === "txt" || value === "plaintext") {
    return "text";
  }
  const normalized = LANG_ALIASES[value] ?? value;
  return /^[a-z0-9][a-z0-9-]{0,31}$/.test(normalized) ? normalized : null;
}

function serveClientAsset(name: string): Response {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return text("not found", 404);
  }
  try {
    const data = readFileSync(resolve("dist/client", name));
    const ext = extname(name).slice(1).toLowerCase();
    return new Response(data, {
      headers: baseHeaders(CLIENT_TYPES[ext] || "application/octet-stream"),
    });
  } catch {
    return text("not found", 404);
  }
}

export function createRoutes(deps: RouteDeps): RoutesHandle {
  const { config, registry, themes } = deps;
  const fonts = deps.fonts ?? createFontCatalog();
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const encoder = new TextEncoder();
  /** Connected tabs, mapped to the slug they reported on connect. */
  const clients = new Map<SseController, string | null>();
  const heartbeats = new Map<SseController, ReturnType<typeof setInterval>>();

  function snapshot(): SnapshotEvent {
    const versions: Record<string, number> = {};
    for (const [slug, entry] of registry.entries()) {
      versions[slug] = entry.version;
    }
    return { versions, slugs: registry.list() };
  }

  function eventFrame(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  function send(controller: SseController, event: string, data: unknown): boolean {
    try {
      controller.enqueue(eventFrame(event, data));
      return true;
    } catch {
      remove(controller);
      return false;
    }
  }

  function remove(controller: SseController): void {
    clients.delete(controller);
    const timer = heartbeats.get(controller);
    if (timer) {
      clearInterval(timer);
      heartbeats.delete(controller);
    }
    try {
      controller.close();
    } catch {
      /* already closed */
    }
  }

  function broadcast(event: string, data: unknown): void {
    for (const controller of [...clients.keys()]) {
      send(controller, event, data);
    }
  }

  function openStream(req: Request, url: URL): Response {
    const requested = url.searchParams.get("doc") ?? "";
    const doc = requested !== "" && requested.length <= 2048 ? requested : null;
    let controllerRef: SseController | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        clients.set(controller, doc);
        send(controller, "snapshot", snapshot());
        const timer = setInterval(() => {
          if (!send(controller, "ping", { ts: Date.now() })) {
            return;
          }
          deps.onActivity();
        }, heartbeatMs);
        heartbeats.set(controller, timer);
        req.signal.addEventListener(
          "abort",
          () => {
            remove(controller);
          },
          { once: true }
        );
      },
      cancel() {
        if (controllerRef) {
          remove(controllerRef);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...SECURITY_HEADERS,
      },
    });
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
    return json({ slug: registry.register(payload.slug, filePath, content) });
  }

  async function waitForClients(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (clients.size === 0 && Date.now() < deadline) {
      await Bun.sleep(50);
    }
  }

  /**
   * Show a document in an existing tab when possible, otherwise tell the CLI
   * that it should open the browser.
   *
   * Tabs whose reported slug matches the target are only asked to focus. When
   * no tab shows the document, the most recently connected tab is asked to
   * navigate in place, which avoids a duplicate tab.
   */
  async function activateHandler(req: Request): Promise<Response> {
    let data: unknown;
    try {
      data = await req.json();
    } catch {
      return text("bad request", 400);
    }
    const payload = data as { slug?: unknown; url?: unknown };
    const rawUrl = typeof payload?.url === "string" ? payload.url : "";
    if (rawUrl === "" || rawUrl.length > 4096) {
      return text("bad request", 400);
    }
    const host = req.headers.get("host") ?? "";
    let target: URL;
    try {
      target = new URL(rawUrl, `http://${host}`);
    } catch {
      return text("bad request", 400);
    }
    if (target.protocol !== "http:" || host === "" || target.host !== host) {
      return text("bad request", 400);
    }
    const slug = typeof payload.slug === "string" ? payload.slug : "";
    const event: ActivateEvent = {
      slug,
      url: target.pathname + target.search,
      ts: Date.now(),
    };

    if (
      clients.size === 0 &&
      deps.browser.openedAt !== null &&
      Date.now() - deps.browser.openedAt < ACTIVATE_GRACE_MS
    ) {
      await waitForClients(ACTIVATE_WAIT_MS);
    }

    const matching = [...clients]
      .filter(([, doc]) => doc !== null && doc === slug)
      .map(([controller]) => controller);
    const focused = matching.filter((controller) => send(controller, "activate", event));
    if (focused.length > 0) {
      return json({ action: "focused", clients: clients.size, matched: focused.length });
    }

    const controllers = [...clients.keys()];
    const fallback = controllers[controllers.length - 1];
    if (fallback && send(fallback, "activate", event)) {
      return json({ action: "navigated", clients: clients.size, matched: 1 });
    }

    const first = !deps.browser.opened;
    deps.browser.markOpened(event.url);
    return json({ action: "opened", first, clients: 0 });
  }

  async function serveSlug(route: string, req: Request, url: URL): Promise<Response> {
    const slug = route.slice(1);
    const entry = registry.get(slug);
    if (!entry) {
      return text("not found", 404);
    }

    const content = entryContent(entry);
    const source = previewSourceFor(entry.path, content);
    if (!source.previewable) {
      return text(
        `not previewable: ${entry.path ? basename(entry.path) : slug} (binary or larger than 1 MiB)`,
        415
      );
    }

    const themeName = resolveThemeName(
      url.searchParams.get("theme"),
      cookieValue(req.headers.get("cookie"), "mdprv_theme"),
      config.theme,
      themes
    );
    const emojiName = resolveEmojiPackName(
      url.searchParams.get("emoji"),
      cookieValue(req.headers.get("cookie"), "mdprv_emoji"),
      config.emoji,
      deps.emojis
    );
    const emojiPack = deps.emojis.get(emojiName);
    const iconName = resolveIconPackName(
      url.searchParams.get("icons"),
      cookieValue(req.headers.get("cookie"), "mdprv_icons"),
      config.icons,
      deps.icons
    );
    const iconPack = deps.icons.get(iconName);
    const prefs = parseThemePrefs(cookieValue(req.headers.get("cookie"), THEME_PREFS_COOKIE), {
      isShikiTheme: isKnownShikiTheme,
      isMermaidTheme: isKnownMermaidTheme,
    });
    // Markdown: frontmatter as before. Wrapped: no frontmatter, body = fence.
    const { data, body: markdownBody } = source.wrapped
      ? { data: {} as Record<string, unknown>, body: source.markdown }
      : parseFrontmatter(content);
    const metaTitle =
      typeof data.title === "string" || typeof data.title === "number"
        ? String(data.title).trim()
        : "";
    const title = metaTitle || (entry.path ? basename(entry.path) : "Markdown Preview");
    const themeParam = url.searchParams.get("theme");
    const body = await renderMarkdown(normalizeContent(markdownBody), themeName, slug, {
      docLinkResolver: createDocLinkResolver(registry, slug, themeParam),
      themeOverrides: prefs,
      emoji: emojiPack,
    });
    const nonce = randomBytes(16).toString("base64");
    return new Response(
      renderPage(
        {
          title,
          body,
          themeName,
          loader: config.loader,
          loaderFrom: config.loaderFrom,
          zoomSensitivity: config.zoomSensitivity,
          meta: data,
          raw: content,
        },
        addNonce(loadShell(), nonce),
        themes,
        { prefs, config: pageConfig(config), emojiName: emojiPack.name, iconName: iconPack.name }
      ),
      {
        headers: {
          ...baseHeaders("text/html; charset=utf-8"),
          "Content-Security-Policy": contentSecurityPolicy(nonce),
        },
      }
    );
  }

  /**
   * Lazy Shiki pass for the raw view. The page payload only carries the plain
   * Markdown; the client asks for this fragment the first time raw is opened.
   */
  async function serveRawHighlight(req: Request, url: URL, head: boolean): Promise<Response> {
    const slug = url.searchParams.get("slug") ?? "";
    const entry = registry.get(slug);
    if (!entry) {
      return text("not found", 404, head);
    }
    const themeName = resolveThemeName(
      url.searchParams.get("theme"),
      cookieValue(req.headers.get("cookie"), "mdprv_theme"),
      config.theme,
      themes
    );
    const prefs = parseThemePrefs(cookieValue(req.headers.get("cookie"), THEME_PREFS_COOKIE), {
      isShikiTheme: isKnownShikiTheme,
      isMermaidTheme: isKnownMermaidTheme,
    });
    await warmup();
    const pair = await prepareShikiPair(themeName, prefs);
    const language =
      entry.path === "" || isMarkdownPath(entry.path) ? "markdown" : languageForFile(entry.path);
    const html = codeToHtmlWithPair(entryContent(entry), language, pair);
    return new Response(head ? null : html, {
      headers: baseHeaders("text/html; charset=utf-8"),
    });
  }

  function serveDoc(url: URL, head: boolean): Response {
    const from = url.searchParams.get("from") ?? "";
    const rel = url.searchParams.get("rel") ?? "";
    const resolved = resolveDocFile(registry, from, rel);
    if (!resolved) {
      return text("not found", 404, head);
    }
    const slug = registry.register(slugFor(resolved.path), resolved.path, null);
    return new Response(null, {
      status: 302,
      headers: {
        ...baseHeaders("text/plain; charset=utf-8"),
        Location: "/" + encodeSlugPath(slug) + resolved.suffix,
      },
    });
  }

  /**
   * Unregister a document from the sidebar without deleting it from disk.
   *
   * Only an already registered slug is accepted; nothing is created on the
   * fly, so `DELETE` cannot be used to probe the filesystem.
   */
  function deleteDoc(route: string): Response {
    const slug = route.slice("/__doc/".length);
    if (!slug || !registry.get(slug)) {
      return text("not found", 404);
    }
    if (!registry.unregister(slug)) {
      return text("not found", 404);
    }
    return new Response(null, {
      status: 204,
      headers: baseHeaders("text/plain; charset=utf-8"),
    });
  }

  async function handle(req: Request): Promise<Response> {
    if (!hostAllowed(req) || !originAllowed(req)) {
      return text("forbidden", 403);
    }
    deps.onActivity();
    const url = new URL(req.url);
    const route = safeDecode(url.pathname);
    const method = req.method.toUpperCase();

    if ((method === "GET" || method === "HEAD") && route === "/__health") {
      return json({ status: "ok", version: VERSION });
    }
    if (method === "PUT" && route === "/__register") {
      if (!tokenMatches(req, deps.token)) {
        return text("unauthorized", 401);
      }
      return registerHandler(req);
    }
    if (method === "POST" && route === "/__activate") {
      if (!tokenMatches(req, deps.token)) {
        return text("unauthorized", 401);
      }
      return activateHandler(req);
    }
    if (method === "POST" && route === "/__shutdown") {
      if (!tokenMatches(req, deps.token)) {
        return text("unauthorized", 401);
      }
      setTimeout(() => {
        deps.requestShutdown();
      }, 50);
      return text("bye");
    }
    if (method === "GET" && route === "/__events") {
      return openStream(req, url);
    }
    if ((method === "GET" || method === "HEAD") && route === "/__themes") {
      return json(
        {
          themes: themes.names(),
          catalog: themeCatalog(themes),
          errors: themes.errors(),
        },
        200,
        method === "HEAD"
      );
    }
    if (method === "POST" && route === "/__themes") {
      return importColorTheme(req, { dir: themes.dir, themes });
    }
    if (method === "DELETE" && route.startsWith("/__themes/")) {
      const name = route.slice("/__themes/".length);
      return deleteColorTheme(req, name, { dir: themes.dir, themes });
    }
    if ((method === "GET" || method === "HEAD") && route === "/__theme-css") {
      const name = url.searchParams.get("name");
      if (!themes.has(name)) {
        return text("not found", 404, method === "HEAD");
      }
      return css(themeCss(themes.get(name)), method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route === "/__shiki-themes") {
      return json(shikiThemesPayload(deps.shikiThemes), 200, method === "HEAD");
    }    if (method === "POST" && route === "/__shiki-themes") {
      return importShikiTheme(req, { dir: deps.shikiThemes.dir, store: deps.shikiThemes });
    }
    if (method === "POST" && route === "/__shiki-themes/preview") {
      return previewShikiImport(req);
    }
    if (method === "DELETE" && route.startsWith("/__shiki-themes/")) {
      const name = route.slice("/__shiki-themes/".length);
      return deleteShikiTheme(req, name, {
        dir: deps.shikiThemes.dir,
        store: deps.shikiThemes,
      });
    }
    if ((method === "GET" || method === "HEAD") && route === "/__mermaid-themes") {
      return json(
        { themes: mermaidThemeEntries(), errors: deps.mermaidThemes.errors() },
        200,
        method === "HEAD"
      );
    }
    if (method === "POST" && route === "/__mermaid-themes") {
      return importMermaidTheme(req, {
        dir: deps.mermaidThemes.dir,
        store: deps.mermaidThemes,
      });
    }
    if (method === "DELETE" && route.startsWith("/__mermaid-themes/")) {
      const name = route.slice("/__mermaid-themes/".length);
      return deleteMermaidTheme(req, name, {
        dir: deps.mermaidThemes.dir,
        store: deps.mermaidThemes,
      });
    }
    if ((method === "GET" || method === "HEAD") && route === "/__emojis") {
      return json(emojisPayload(deps.emojis), 200, method === "HEAD");
    }
    if (method === "POST" && route === "/__emojis") {
      return importEmojiPack(req, { dir: deps.emojis.dir, store: deps.emojis });
    }
    if (method === "DELETE" && route.startsWith("/__emojis/")) {
      const name = route.slice("/__emojis/".length);
      return deleteEmojiPack(req, name, { dir: deps.emojis.dir, store: deps.emojis });
    }
    if ((method === "GET" || method === "HEAD") && route.startsWith("/__emoji-samples/")) {
      const name = route.slice("/__emoji-samples/".length);
      return emojiSamplesResponse(name, deps.emojis, method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route.startsWith("/__emoji-assets/")) {
      const rest = route.slice("/__emoji-assets/".length);
      const slash = rest.indexOf("/");
      if (slash <= 0) {
        return text("not found", 404, method === "HEAD");
      }
      return serveEmojiAsset(
        rest.slice(0, slash),
        rest.slice(slash + 1),
        deps.emojis,
        method === "HEAD"
      );
    }
    if ((method === "GET" || method === "HEAD") && route === "/__icons") {
      return json(iconsPayload(deps.icons), 200, method === "HEAD");
    }
    if (method === "POST" && route === "/__icons") {
      return importIconPack(req, { dir: deps.icons.dir, store: deps.icons });
    }
    if (method === "DELETE" && route.startsWith("/__icons/")) {
      const name = route.slice("/__icons/".length);
      return deleteIconPack(req, name, { dir: deps.icons.dir, store: deps.icons });
    }
    if ((method === "GET" || method === "HEAD") && route.startsWith("/__icon-assets/")) {
      const rest = route.slice("/__icon-assets/".length);
      const slash = rest.indexOf("/");
      if (slash <= 0) {
        return text("not found", 404, method === "HEAD");
      }
      return serveIconAsset(
        rest.slice(0, slash),
        rest.slice(slash + 1),
        deps.icons,
        method === "HEAD"
      );
    }
    if ((method === "GET" || method === "HEAD") && route === "/__preview/code") {
      const requested = url.searchParams.get("theme");
      if (requested === null || !isKnownShikiTheme(requested)) {
        return text("invalid theme", 400, method === "HEAD");
      }
      const language = previewLanguage(url.searchParams.get("lang"));
      if (language === null) {
        return text("invalid lang", 400, method === "HEAD");
      }
      await warmup();
      return json(
        await codeToHtmlSingle(CODE_PREVIEW_SAMPLE, language, requested),
        200,
        method === "HEAD"
      );
    }
    if (method === "DELETE" && route.startsWith("/__doc/")) {
      if (!sameOriginRequest(req) || !fetchSiteAllowed(req)) {
        return text("forbidden", 403);
      }
      return deleteDoc(route);
    }
    if ((method === "GET" || method === "HEAD") && route === "/__doc") {
      return serveDoc(url, method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route === "/__raw-highlight") {
      return serveRawHighlight(req, url, method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route.startsWith("/__assets/")) {
      const name = route.slice("/__assets/".length);
      if (name === "mermaid.min.js") {
        return mermaidAsset();
      }
      return serveClientAsset(name);
    }
    if ((method === "GET" || method === "HEAD") && route === "/__fonts") {
      const refresh = url.searchParams.get("refresh") === "1";
      const payload = await fonts.getFonts({ refresh });
      return json(payload, 200, method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route === "/__fonts/google") {
      const result = await fonts.getGoogleCss(url.searchParams.get("family") ?? "");
      if (!result.ok) {
        return text(result.message, result.status, method === "HEAD");
      }
      return css(result.css, method === "HEAD");
    }
    if ((method === "GET" || method === "HEAD") && route.startsWith("/__fonts/file/")) {
      const hash = route.slice("/__fonts/file/".length);
      const result = fonts.getFontFile(hash);
      if (!result.ok) {
        return text("not found", 404, method === "HEAD");
      }
      return fontFile(result.data, method === "HEAD");
    }

    if (method === "GET" || method === "HEAD") {
      if (route.startsWith("/img/")) {
        return serveImage(route.slice("/img/".length), registry.entries());
      }
      return serveSlug(route, req, url);
    }

    if (method === "PUT" || method === "POST") {
      return text("not found", 404);
    }
    return text("method not allowed", 405);
  }

  return {
    handle,
    broadcast,
    close() {
      for (const controller of [...clients.keys()]) {
        remove(controller);
      }
    },
  };
}
