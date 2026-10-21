import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==",
  "base64"
);

let dir: string;
let daemon: DaemonHandle;
let base: string;

function config(stateFile: string): Config {
  return {
    port: 0,
    idleMs: 60_000,
    stateFile,
    theme: "auto",
    loader: "classic",
    zoomSensitivity: 1.1,
  };
}

async function register(slug: string, path: string, content: string, token = daemon.token) {
  return fetch(`${base}/__register`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-mdprv-token": token },
    body: JSON.stringify({ slug, path, content }),
  });
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "mdprv-sec-"));
  const doc = join(dir, "doc.md");
  writeFileSync(doc, "# Secure\n");
  writeFileSync(join(dir, "photo.png"), PNG);
  daemon = createDaemon(config(join(dir, "state", "daemon.json")), { heartbeatMs: 50 });
  base = `http://127.0.0.1:${daemon.port}`;
  const response = await register("doc", doc, readFileSync(doc, "utf8"));
  expect(response.status).toBe(200);
});

afterAll(() => {
  daemon?.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe("daemon request authorization", () => {
  it("rejects register without the daemon token", async () => {
    const response = await fetch(`${base}/__register`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: "x", path: join(dir, "doc.md"), content: "# x\n" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects register with a wrong token", async () => {
    const response = await register("x", join(dir, "doc.md"), "# x\n", "wrong-token-1234567890");
    expect(response.status).toBe(401);
  });

  it("rejects shutdown without the daemon token", async () => {
    const response = await fetch(`${base}/__shutdown`, { method: "POST" });
    expect(response.status).toBe(401);
  });

  it("rejects a foreign Host header (DNS rebinding)", async () => {
    const response = await fetch(`${base}/doc`, { headers: { host: "evil.test" } });
    expect(response.status).toBe(403);
  });

  it("rejects a foreign Origin header", async () => {
    const response = await fetch(`${base}/doc`, { headers: { origin: "https://evil.test" } });
    expect(response.status).toBe(403);
  });

  it("accepts a loopback Origin header", async () => {
    const response = await fetch(`${base}/doc`, { headers: { origin: base } });
    expect(response.status).toBe(200);
  });
});

describe("page content security policy", () => {
  it("serves a nonce-based CSP and stamps the shell scripts", async () => {
    const response = await fetch(`${base}/doc`);
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");

    const html = await response.text();
    expect(html).toContain(`<script nonce="${nonce}"`);
    expect(html).toMatch(/<script nonce="[^"]+" src="\/__assets\/mermaid\.min\.js"/);

    const scriptSrc = csp.split(";").find((part) => part.trim().startsWith("script-src")) ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("does not grant a nonce to raw HTML scripts from the Markdown", async () => {
    const doc = join(dir, "raw.md");
    writeFileSync(doc, '# Raw\n\n<script>alert("x")</script>\n');
    const registered = await register("raw", doc, readFileSync(doc, "utf8"));
    expect(registered.status).toBe(200);

    const response = await fetch(`${base}/raw`);
    const csp = response.headers.get("content-security-policy") ?? "";
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    const html = await response.text();
    expect(nonce).toBeDefined();
    expect(html).toContain('<script>alert("x")</script>');
    expect(html).toContain(`<script nonce="${nonce}"`);
    expect(html).not.toContain(`<script nonce="${nonce}">alert`);
  });

  it("adds hardening headers", async () => {
    const response = await fetch(`${base}/doc`);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });
});

describe("image serving boundaries", () => {
  it("serves a registered relative image", async () => {
    const response = await fetch(`${base}/img/doc/photo.png`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("refuses non-image files even inside the document directory", async () => {
    const response = await fetch(`${base}/img/doc/doc.md`);
    expect(response.status).toBe(404);
  });

  it("refuses symlinks that escape the document directory", async () => {
    const outside = join(tmpdir(), `mdprv-outside-${Date.now()}.png`);
    writeFileSync(outside, PNG);
    try {
      symlinkSync(outside, join(dir, "escape.png"));
      const response = await fetch(`${base}/img/doc/escape.png`);
      expect(response.status).toBe(404);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
