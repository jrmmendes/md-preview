import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";

import type { Config } from "../../core/config";
import type { SnapshotEvent } from "../../core/contract";
import { renderPage } from "../../core/page";
import { normalizeContent, renderMarkdown } from "../../core/markdown/render";
import { resolveThemeName } from "../../core/themes/resolve";
import { themeNames } from "../../core/themes/tokens";
import { VERSION } from "../../core/version";
import { parseFrontmatter } from "../../core/frontmatter";
import { mermaidAsset } from "./assets";
import { createFontCatalog, type FontCatalog } from "./fonts";
import { baseHeaders, fontAssetHeaders, SECURITY_HEADERS } from "./headers";
import { serveImage } from "./images";
import { loadShell } from "./shell";
import type { SlugRegistry } from "./watch";

const CLIENT_TYPES: Record<string, string> = {
  js: "application/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

const DEFAULT_HEARTBEAT_MS = 20_000;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "0:0:0:0:0:0:0:1"]);

type SseController = ReadableStreamDefaultController<Uint8Array>;

export interface RouteDeps {
  config: Config;
  registry: SlugRegistry;
  token: string;
  onActivity: () => void;
  requestShutdown: () => void;
  heartbeatMs?: number;
  fonts?: FontCatalog;
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
  const { config, registry } = deps;
  const fonts = deps.fonts ?? createFontCatalog();
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  const encoder = new TextEncoder();
  const clients = new Set<SseController>();
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
    for (const controller of [...clients]) {
      send(controller, event, data);
    }
  }

  function openStream(req: Request): Response {
    let controllerRef: SseController | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        clients.add(controller);
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

  async function serveSlug(route: string, req: Request, url: URL): Promise<Response> {
    const slug = route.slice(1);
    const entry = registry.get(slug);
    if (!entry) {
      return text("not found", 404);
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
      config.theme
    );
    const { data, body: markdownBody } = parseFrontmatter(content);
    const metaTitle =
      typeof data.title === "string" || typeof data.title === "number"
        ? String(data.title).trim()
        : "";
    const title = metaTitle || (entry.path ? basename(entry.path) : "Markdown Preview");
    const body = await renderMarkdown(normalizeContent(markdownBody), themeName, slug);
    const nonce = randomBytes(16).toString("base64");
    return new Response(
      renderPage(
        {
          title,
          body,
          themeName,
          loader: config.loader,
          zoomSensitivity: config.zoomSensitivity,
          meta: data,
        },
        addNonce(loadShell(), nonce)
      ),
      {
        headers: {
          ...baseHeaders("text/html; charset=utf-8"),
          "Content-Security-Policy": contentSecurityPolicy(nonce),
        },
      }
    );
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
      return openStream(req);
    }
    if ((method === "GET" || method === "HEAD") && route === "/__themes") {
      return json({ themes: themeNames() });
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
      for (const controller of [...clients]) {
        remove(controller);
      }
    },
  };
}
