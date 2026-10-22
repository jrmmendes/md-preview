import { createHash } from "node:crypto";

import type { FontsPayload } from "../../core/contract";
import {
  categorizeFamily,
  GENERIC_FAMILIES,
  normalizeFonts,
  parseFcList,
} from "../../core/fonts";

export interface ExecResult {
  ok: boolean;
  code: number;
  stdout: string;
  error?: string;
  timedOut?: boolean;
}

export type ExecFn = (args: readonly string[]) => Promise<ExecResult>;

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export interface FontCatalogOptions {
  exec?: ExecFn;
  fetch?: FetchFn;
  now?: () => number;
  ttlMs?: number;
  fcTimeoutMs?: number;
  maxFcOutputBytes?: number;
  googleTimeoutMs?: number;
  maxCssBytes?: number;
  maxFontBytes?: number;
  maxFontFiles?: number;
  maxCssEntries?: number;
  cssTtlMs?: number;
}

export interface GoogleCssSuccess {
  ok: true;
  family: string;
  css: string;
}

export type GoogleCssFailureReason =
  | "invalid-family"
  | "upstream"
  | "not-found"
  | "timeout"
  | "too-large"
  | "external-url"
  | "no-fonts";

export interface GoogleCssFailure {
  ok: false;
  status: 400 | 404 | 502;
  reason: GoogleCssFailureReason;
  message: string;
}

export type GoogleCssResult = GoogleCssSuccess | GoogleCssFailure;

export interface FontFileSuccess {
  ok: true;
  hash: string;
  data: Uint8Array;
}

export interface FontFileFailure {
  ok: false;
  reason: "not-found";
}

export type FontFileResult = FontFileSuccess | FontFileFailure;

export interface FontCatalog {
  getFonts(options?: { refresh?: boolean }): Promise<FontsPayload>;
  getGoogleCss(family: string): Promise<GoogleCssResult>;
  getFontFile(hash: string): FontFileResult;
}

const FC_LIST_ARGS = [
  "fc-list",
  "--format",
  "%{family}\t%{style}\t%{spacing}\n",
] as const;

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_FC_TIMEOUT_MS = 3000;
const DEFAULT_MAX_FC_OUTPUT_BYTES = 512 * 1024;
const DEFAULT_GOOGLE_TIMEOUT_MS = 5000;
const DEFAULT_MAX_CSS_BYTES = 256 * 1024;
const DEFAULT_MAX_FONT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FONT_FILES = 64;
const DEFAULT_MAX_CSS_ENTRIES = 64;
const DEFAULT_CSS_TTL_MS = 24 * 60 * 60 * 1000;

const GOOGLE_CSS_BASE = "https://fonts.googleapis.com/css2?family=";
const GSTATIC_PREFIX = "https://fonts.gstatic.com/";
const GOOGLE_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '&+.-]{0,63}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function readBodyLimited(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxBytes: number
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!stream) {
    return { bytes: new Uint8Array(0), truncated: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.subarray(0, remaining));
          total += remaining;
        }
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* stream already closed */
        }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* reader already released */
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

async function defaultExec(
  args: readonly string[],
  timeoutMs: number,
  maxOutputBytes: number
): Promise<ExecResult> {
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn([...args], { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
  } catch (error) {
    return { ok: false, code: -1, stdout: "", error: String(error) };
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGKILL");
    } catch {
      /* process already exited */
    }
  }, timeoutMs);

  try {
    const { bytes, truncated } = await readBodyLimited(proc.stdout, maxOutputBytes);
    if (truncated) {
      try {
        proc.kill("SIGKILL");
      } catch {
        /* process already exited */
      }
    }
    const code = await proc.exited;
    if (timedOut) {
      return { ok: false, code, stdout: "", error: "fc-list timed out", timedOut: true };
    }
    if (truncated) {
      return { ok: false, code, stdout: "", error: "fc-list output limit reached" };
    }
    if (code !== 0) {
      return { ok: false, code, stdout: "", error: `fc-list exited with ${code}` };
    }
    return { ok: true, code, stdout: new TextDecoder().decode(bytes) };
  } catch (error) {
    try {
      proc.kill("SIGKILL");
    } catch {
      /* process already exited */
    }
    return { ok: false, code: -1, stdout: "", error: String(error), timedOut };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackPayload(now: () => number): FontsPayload {
  const fonts = GENERIC_FAMILIES.map((family) => ({
    family,
    styles: [] as string[],
    category: categorizeFamily(family),
  }));
  return {
    available: false,
    source: "fallback",
    fonts,
    generatedAt: new Date(now()).toISOString(),
    total: fonts.length,
  };
}

function cssFailure(
  status: 400 | 404 | 502,
  reason: GoogleCssFailureReason,
  message: string
): GoogleCssFailure {
  return { ok: false, status, reason, message };
}

interface CssCacheEntry {
  family: string;
  css: string;
  expiresAt: number;
}

export function createFontCatalog(options: FontCatalogOptions = {}): FontCatalog {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const fcTimeoutMs = options.fcTimeoutMs ?? DEFAULT_FC_TIMEOUT_MS;
  const maxFcOutputBytes = options.maxFcOutputBytes ?? DEFAULT_MAX_FC_OUTPUT_BYTES;
  const googleTimeoutMs = options.googleTimeoutMs ?? DEFAULT_GOOGLE_TIMEOUT_MS;
  const maxCssBytes = options.maxCssBytes ?? DEFAULT_MAX_CSS_BYTES;
  const maxFontBytes = options.maxFontBytes ?? DEFAULT_MAX_FONT_BYTES;
  const maxFontFiles = options.maxFontFiles ?? DEFAULT_MAX_FONT_FILES;
  const maxCssEntries = options.maxCssEntries ?? DEFAULT_MAX_CSS_ENTRIES;
  const cssTtlMs = options.cssTtlMs ?? DEFAULT_CSS_TTL_MS;
  const exec =
    options.exec ??
    ((args: readonly string[]) => defaultExec(args, fcTimeoutMs, maxFcOutputBytes));
  const fetchImpl = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));

  let cached: FontsPayload | null = null;
  let expiresAt = 0;
  let pending: Promise<FontsPayload> | null = null;

  const cssCache = new Map<string, CssCacheEntry>();
  const cssPending = new Map<string, Promise<GoogleCssResult>>();
  const fontFiles = new Map<string, Uint8Array>();

  async function runFcList(): Promise<string | null> {
    let result: ExecResult;
    try {
      result = await withTimeout(exec(FC_LIST_ARGS), fcTimeoutMs, () => ({
        ok: false,
        code: -1,
        stdout: "",
        error: "fc-list timed out",
        timedOut: true,
      }));
    } catch {
      return null;
    }
    if (!result.ok || result.stdout.trim() === "") {
      return null;
    }
    return result.stdout;
  }

  async function loadFonts(): Promise<FontsPayload> {
    const raw = await runFcList();
    if (raw === null) {
      return fallbackPayload(now);
    }
    const fonts = normalizeFonts(parseFcList(raw));
    if (fonts.length === 0) {
      return fallbackPayload(now);
    }
    return {
      available: true,
      source: "system",
      fonts,
      generatedAt: new Date(now()).toISOString(),
      total: fonts.length,
    };
  }

  async function getFonts(getOptions: { refresh?: boolean } = {}): Promise<FontsPayload> {
    if (!getOptions.refresh && cached !== null && now() < expiresAt) {
      return cached;
    }
    if (pending === null) {
      pending = loadFonts()
        .catch(() => fallbackPayload(now))
        .then((payload) => {
          cached = payload;
          expiresAt = now() + ttlMs;
          return payload;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  }

  function storeFontFile(hash: string, data: Uint8Array): void {
    fontFiles.delete(hash);
    fontFiles.set(hash, data);
    while (fontFiles.size > maxFontFiles) {
      const oldest = fontFiles.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      fontFiles.delete(oldest);
    }
  }

  function getFontFile(hash: string): FontFileResult {
    if (!HASH_PATTERN.test(hash)) {
      return { ok: false, reason: "not-found" };
    }
    const data = fontFiles.get(hash);
    if (!data) {
      return { ok: false, reason: "not-found" };
    }
    fontFiles.delete(hash);
    fontFiles.set(hash, data);
    return { ok: true, hash, data };
  }

  async function fetchWithTimeout(
    url: string,
    init: RequestInit
  ): Promise<{ response: Response } | { failure: GoogleCssFailure }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ failure: GoogleCssFailure }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ failure: cssFailure(502, "timeout", "font upstream timed out") });
      }, googleTimeoutMs);
    });
    const request = (async (): Promise<{ response: Response } | { failure: GoogleCssFailure }> => {
      try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        return { response };
      } catch (error) {
        if (isAbortError(error)) {
          return { failure: cssFailure(502, "timeout", "font upstream timed out") };
        }
        return { failure: cssFailure(502, "upstream", "font upstream request failed") };
      }
    })();

    try {
      return await Promise.race([request, timeout]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  async function downloadFont(
    url: string
  ): Promise<
    | { ok: true; hash: string }
    | { ok: false; status: 404 | 502; reason: GoogleCssFailureReason; message: string }
  > {
    const fetched = await fetchWithTimeout(url, {
      credentials: "omit",
      headers: { "User-Agent": GOOGLE_USER_AGENT },
    });
    if ("failure" in fetched) {
      return {
        ok: false,
        status: 502,
        reason: fetched.failure.reason,
        message: fetched.failure.message,
      };
    }
    const { response } = fetched;
    if (!response.ok) {
      if (response.status === 404) {
        return { ok: false, status: 404, reason: "not-found", message: "font file not found" };
      }
      return {
        ok: false,
        status: 502,
        reason: "upstream",
        message: `font file upstream status ${response.status}`,
      };
    }
    const body = await readBodyLimited(response.body, maxFontBytes);
    if (body.truncated) {
      return { ok: false, status: 502, reason: "too-large", message: "font file too large" };
    }
    const hash = createHash("sha256").update(body.bytes).digest("hex");
    storeFontFile(hash, body.bytes);
    return { ok: true, hash };
  }

  async function loadGoogleCss(family: string): Promise<GoogleCssResult> {
    const url = `${GOOGLE_CSS_BASE}${encodeURIComponent(family)}&display=swap`;
    const fetched = await fetchWithTimeout(url, {
      credentials: "omit",
      headers: {
        "User-Agent": GOOGLE_USER_AGENT,
        Accept: "text/css,*/*;q=0.1",
      },
    });
    if ("failure" in fetched) {
      return fetched.failure;
    }
    const { response } = fetched;
    if (!response.ok) {
      if (response.status === 404) {
        return cssFailure(404, "not-found", "font family not found");
      }
      return cssFailure(502, "upstream", `font upstream status ${response.status}`);
    }

    const body = await readBodyLimited(response.body, maxCssBytes);
    if (body.truncated) {
      return cssFailure(502, "too-large", "font CSS too large");
    }
    const css = new TextDecoder().decode(body.bytes);

    const urls = new Set<string>();
    for (const match of css.matchAll(URL_PATTERN)) {
      const target = match[2]?.trim();
      if (!target) {
        continue;
      }
      if (!target.startsWith(GSTATIC_PREFIX)) {
        return cssFailure(502, "external-url", "font URL outside fonts.gstatic.com");
      }
      urls.add(target);
    }
    if (urls.size === 0) {
      return cssFailure(502, "no-fonts", "font CSS contains no font files");
    }

    const replacements = new Map<string, string>();
    for (const target of urls) {
      const file = await downloadFont(target);
      if (!file.ok) {
        return cssFailure(file.status, file.reason, file.message);
      }
      replacements.set(target, file.hash);
    }

    const rewritten = css.replace(
      URL_PATTERN,
      (match, quote: string, target: string): string => {
        const hash = replacements.get(target.trim());
        if (!hash) {
          return match;
        }
        const wrapper = quote === "'" || quote === '"' ? quote : "";
        return `url(${wrapper}/__fonts/file/${hash}${wrapper})`;
      }
    );

    return { ok: true, family, css: rewritten };
  }

  async function getGoogleCss(rawFamily: string): Promise<GoogleCssResult> {
    const family = rawFamily.trim();
    if (!FAMILY_PATTERN.test(family)) {
      return cssFailure(400, "invalid-family", "invalid font family");
    }
    const key = family.toLowerCase();
    const cachedCss = cssCache.get(key);
    if (cachedCss && now() < cachedCss.expiresAt) {
      return { ok: true, family: cachedCss.family, css: cachedCss.css };
    }
    const inFlight = cssPending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const task = loadGoogleCss(family)
      .catch(() => cssFailure(502, "upstream", "font proxy request failed"))
      .then((result) => {
        if (result.ok) {
          cssCache.delete(key);
          cssCache.set(key, {
            family: result.family,
            css: result.css,
            expiresAt: now() + cssTtlMs,
          });
          while (cssCache.size > maxCssEntries) {
            const oldest = cssCache.keys().next().value;
            if (oldest === undefined) {
              break;
            }
            cssCache.delete(oldest);
          }
        }
        return result;
      })
      .finally(() => {
        cssPending.delete(key);
      });
    cssPending.set(key, task);
    return task;
  }

  return { getFonts, getGoogleCss, getFontFile };
}
