import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  createFontCatalog,
  type ExecResult,
  type FetchFn,
} from "../src/application/daemon/fonts";
import { GENERIC_FAMILIES } from "../src/core/fonts";

function okExec(stdout: string): ExecResult {
  return { ok: true, code: 0, stdout };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const CSS = [
  '@font-face{font-family:"Roboto";font-style:normal;src:url(https://fonts.gstatic.com/s/roboto/v1/a.woff2) format("woff2");}',
  '@font-face{font-family:"Roboto";font-weight:700;src:url("https://fonts.gstatic.com/s/roboto/v1/b.woff2") format("woff2");}',
].join("\n");

const FILE_A = new Uint8Array([1, 2, 3, 4]);
const FILE_B = new Uint8Array([5, 6, 7, 8]);

function googleFetch(css = CSS, files = new Map<string, Uint8Array>()): {
  fetch: FetchFn;
  requests: string[];
  inits: RequestInit[];
} {
  const requests: string[] = [];
  const inits: RequestInit[] = [];
  const table =
    files.size > 0
      ? files
      : new Map([
          ["https://fonts.gstatic.com/s/roboto/v1/a.woff2", FILE_A],
          ["https://fonts.gstatic.com/s/roboto/v1/b.woff2", FILE_B],
        ]);
  return {
    requests,
    inits,
    fetch: async (input, init) => {
      requests.push(input);
      inits.push(init ?? {});
      if (input.startsWith("https://fonts.googleapis.com/css2")) {
        return new Response(css, { status: 200, headers: { "Content-Type": "text/css" } });
      }
      const bytes = table.get(input);
      if (!bytes) {
        return new Response("missing", { status: 404 });
      }
      return new Response(bytes, { status: 200 });
    },
  };
}

describe("font catalog", () => {
  it("caches fc-list results, honors the TTL and supports forced refresh", async () => {
    let now = 1_000;
    let calls = 0;
    const catalog = createFontCatalog({
      now: () => now,
      ttlMs: 1_000,
      exec: async () => {
        calls += 1;
        return okExec("Inter\tRegular\t0\n");
      },
    });

    const first = await catalog.getFonts();
    expect(calls).toBe(1);
    expect(first).toEqual({
      available: true,
      source: "system",
      fonts: [{ family: "Inter", styles: ["Regular"], category: "sans" }],
      generatedAt: new Date(1_000).toISOString(),
      total: 1,
    });

    await catalog.getFonts();
    expect(calls).toBe(1);

    now = 2_001;
    await catalog.getFonts();
    expect(calls).toBe(2);

    await catalog.getFonts({ refresh: true });
    expect(calls).toBe(3);
  });

  it("shares one fc-list execution between concurrent requests", async () => {
    let calls = 0;
    let resolveExec: ((value: ExecResult) => void) | undefined;
    const catalog = createFontCatalog({
      now: () => 0,
      exec: () => {
        calls += 1;
        return new Promise<ExecResult>((resolve) => {
          resolveExec = resolve;
        });
      },
    });

    const first = catalog.getFonts();
    const second = catalog.getFonts();
    resolveExec?.(okExec("Inter\tRegular\t0\n"));

    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it("falls back to generic families when fc-list fails or is empty", async () => {
    for (const exec of [
      async (): Promise<ExecResult> => ({ ok: false, code: 127, stdout: "", error: "missing" }),
      async (): Promise<ExecResult> => okExec(""),
      async (): Promise<ExecResult> => okExec("\n\n"),
    ]) {
      const catalog = createFontCatalog({ exec, now: () => 0 });
      const payload = await catalog.getFonts();
      expect(payload.available).toBe(false);
      expect(payload.source).toBe("fallback");
      expect(payload.total).toBe(GENERIC_FAMILIES.length);
      expect(payload.fonts.map((font) => font.family)).toEqual([...GENERIC_FAMILIES]);
    }
  });

  it("falls back when fc-list never resolves", async () => {
    const catalog = createFontCatalog({
      exec: () => new Promise<ExecResult>(() => {}),
      fcTimeoutMs: 10,
      now: () => 0,
    });
    const payload = await catalog.getFonts();
    expect(payload.available).toBe(false);
    expect(payload.source).toBe("fallback");
  });

  it("falls back when the exec dependency throws", async () => {
    const catalog = createFontCatalog({
      exec: async () => {
        throw new Error("spawn failed");
      },
      now: () => 0,
    });
    const payload = await catalog.getFonts();
    expect(payload.available).toBe(false);
    expect(payload.source).toBe("fallback");
  });
});

describe("google font proxy", () => {
  it("downloads every @font-face file and rewrites src URLs to same-origin hashes", async () => {
    let now = 0;
    const fake = googleFetch();
    const catalog = createFontCatalog({
      now: () => now,
      cssTtlMs: 1_000,
      exec: async () => okExec(""),
      fetch: fake.fetch,
    });

    const result = await catalog.getGoogleCss("Roboto");
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const hashA = sha256(FILE_A);
    const hashB = sha256(FILE_B);
    expect(result.css).toContain(`url(/__fonts/file/${hashA})`);
    expect(result.css).toContain(`url("/__fonts/file/${hashB}")`);
    expect(result.css).not.toContain("fonts.gstatic.com");
    expect(fake.requests[0]).toBe(
      "https://fonts.googleapis.com/css2?family=Roboto&display=swap"
    );

    const cssInit = fake.inits[0];
    expect(cssInit.credentials).toBe("omit");
    const headers = new Headers(cssInit.headers);
    expect(headers.get("user-agent")).toContain("Chrome");

    const fileA = catalog.getFontFile(hashA);
    expect(fileA.ok).toBe(true);
    if (fileA.ok) {
      expect([...fileA.data]).toEqual([...FILE_A]);
    }
    expect(catalog.getFontFile(hashB).ok).toBe(true);

    await catalog.getGoogleCss("roboto");
    expect(fake.requests.filter((url) => url.includes("css2")).length).toBe(1);

    now = 1_001;
    await catalog.getGoogleCss("Roboto");
    expect(fake.requests.filter((url) => url.includes("css2")).length).toBe(2);
  });

  it("rejects invalid family names without calling upstream", async () => {
    const fake = googleFetch();
    const catalog = createFontCatalog({
      exec: async () => okExec(""),
      fetch: fake.fetch,
    });

    for (const family of ["", " Roboto;drop", "-Roboto", "a".repeat(65)]) {
      const result = await catalog.getGoogleCss(family);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.reason).toBe("invalid-family");
      }
    }
    expect(fake.requests).toHaveLength(0);
  });

  it("rejects font URLs outside fonts.gstatic.com", async () => {
    const fake = googleFetch('@font-face{src:url(https://evil.test/font.woff2);}');
    const catalog = createFontCatalog({
      exec: async () => okExec(""),
      fetch: fake.fetch,
    });

    const result = await catalog.getGoogleCss("Roboto");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.reason).toBe("external-url");
    }
    expect(fake.requests.some((url) => url.includes("evil.test"))).toBe(false);
  });

  it("maps upstream 404 to a 404 result", async () => {
    const catalog = createFontCatalog({
      exec: async () => okExec(""),
      fetch: async () => new Response("missing", { status: 404 }),
    });
    const result = await catalog.getGoogleCss("Roboto");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.reason).toBe("not-found");
    }
  });

  it("returns a typed timeout when the Google upstream hangs", async () => {
    const catalog = createFontCatalog({
      exec: async () => okExec(""),
      googleTimeoutMs: 10,
      fetch: () => new Promise<Response>(() => {}),
    });
    const result = await catalog.getGoogleCss("Roboto");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.reason).toBe("timeout");
    }
  });

  it("enforces CSS and font file size limits", async () => {
    const tooLargeCss = createFontCatalog({
      exec: async () => okExec(""),
      maxCssBytes: 10,
      fetch: googleFetch().fetch,
    });
    const cssResult = await tooLargeCss.getGoogleCss("Roboto");
    expect(cssResult.ok).toBe(false);
    if (!cssResult.ok) {
      expect(cssResult.reason).toBe("too-large");
      expect(cssResult.status).toBe(502);
    }

    const tooLargeFont = createFontCatalog({
      exec: async () => okExec(""),
      maxFontBytes: 2,
      fetch: googleFetch().fetch,
    });
    const fontResult = await tooLargeFont.getGoogleCss("Roboto");
    expect(fontResult.ok).toBe(false);
    if (!fontResult.ok) {
      expect(fontResult.reason).toBe("too-large");
      expect(fontResult.status).toBe(502);
    }
  });

  it("evicts the least recently used font file when the cache is full", async () => {
    const css = [
      "@font-face{src:url(https://fonts.gstatic.com/s/x/1.woff2);}",
      "@font-face{src:url(https://fonts.gstatic.com/s/x/2.woff2);}",
      "@font-face{src:url(https://fonts.gstatic.com/s/x/3.woff2);}",
    ].join("\n");
    const files = new Map([
      ["https://fonts.gstatic.com/s/x/1.woff2", new Uint8Array([1])],
      ["https://fonts.gstatic.com/s/x/2.woff2", new Uint8Array([2])],
      ["https://fonts.gstatic.com/s/x/3.woff2", new Uint8Array([3])],
    ]);
    const catalog = createFontCatalog({
      exec: async () => okExec(""),
      maxFontFiles: 2,
      fetch: googleFetch(css, files).fetch,
    });

    const result = await catalog.getGoogleCss("Roboto");
    expect(result.ok).toBe(true);
    expect(catalog.getFontFile(sha256(new Uint8Array([1]))).ok).toBe(false);
    expect(catalog.getFontFile(sha256(new Uint8Array([2]))).ok).toBe(true);
    expect(catalog.getFontFile(sha256(new Uint8Array([3]))).ok).toBe(true);
    expect(catalog.getFontFile("not-a-hash").ok).toBe(false);
  });
});
