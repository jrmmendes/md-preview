import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { MermaidThemeEntry } from "../src/core/contract";
import { validateMermaidCustom } from "../src/core/themes/mermaid-custom";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-mermaid-import-"));
  dirs.push(dir);
  return dir;
}

function makeConfig(stateFile: string): Config {
  return {
    port: 0,
    idleMs: 60_000,
    stateFile,
    theme: "auto",
    emoji: "github",
    icons: "breeze",
    loader: "classic",
    loaderFrom: "default",
    zoomSensitivity: 1.1,
    configDir: join(dirname(stateFile), ".."),
    seedThemes: false,
  };
}

afterEach(() => {
  for (const daemon of daemons.splice(0)) {
    daemon.stop();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function start(): { base: string; dir: string; token: string } {
  const dir = tempDir();
  const stateFile = join(dir, "state", "daemon.json");
  const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
  daemons.push(daemon);
  return { base: `http://127.0.0.1:${daemon.port}`, dir, token: daemon.token };
}

function origin(base: string): Record<string, string> {
  return {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
  };
}

function wrapper(name = "meu-diagrama", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    name,
    theme: "base",
    variables: {
      background: "#faf9f5",
      primaryColor: "#d97757",
      primaryTextColor: "#141413",
      lineColor: "#a14a2e",
      primaryBorderColor: "#d97757",
      fontFamily: '"Source Sans 3", sans-serif',
    },
    ...overrides,
  };
}

function payload(html: string): {
  mermaid: { light: { theme: string; themeVariables: Record<string, string> } };
} {
  const match = html.match(
    /<script[^>]*id="mdprv-data"[^>]*>([\s\S]*?)<\/script>/
  );
  if (!match) throw new Error("missing mdprv-data payload");
  return JSON.parse(match[1]) as {
    mermaid: { light: { theme: string; themeVariables: Record<string, string> } };
  };
}

describe("custom Mermaid theme validation", () => {
  it("defaults to base and normalizes the wrapper", () => {
    const parsed = validateMermaidCustom({
      schemaVersion: 1,
      name: "meu-diagrama",
      variables: { primaryColor: "#d97757" },
    });
    expect(parsed.theme).toBe("base");
    expect(parsed.variables).toEqual({ primaryColor: "#d97757" });
  });

  it("rejects unsafe keys and values, builtins and quotas", () => {
    expect(() =>
      validateMermaidCustom(wrapper("meu-diagrama", { variables: { "bad-key": "#fff" } }))
    ).toThrow();
    expect(() =>
      validateMermaidCustom(wrapper("meu-diagrama", { variables: { primaryColor: "url(x)" } }))
    ).toThrow();
    expect(() =>
      validateMermaidCustom(wrapper("meu-diagrama", { variables: { primaryColor: "red;}" } }))
    ).toThrow();
    expect(() => validateMermaidCustom(wrapper("dark"))).toThrow();
    expect(() =>
      validateMermaidCustom(
        wrapper("meu-diagrama", {
          variables: Object.fromEntries(
            Array.from({ length: 513 }, (_, index) => [`key${index}`, "#ffffff"])
          ),
        })
      )
    ).toThrow();
  });
});

describe("Mermaid import endpoints", () => {
  it("imports a theme atomically and lists builtin + custom", async () => {
    const { base, dir } = start();
    const themesDir = join(dir, "themes");

    const initial = (await (await fetch(`${base}/__mermaid-themes`)).json()) as {
      themes: MermaidThemeEntry[];
      errors: unknown[];
    };
    expect(initial.themes.filter((entry) => entry.source === "builtin")).toHaveLength(5);
    expect(initial.errors).toEqual([]);

    const created = await fetch(`${base}/__mermaid-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper()),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      theme: MermaidThemeEntry;
      themes: MermaidThemeEntry[];
    };
    expect(body.theme.name).toBe("meu-diagrama");
    expect(body.theme.source).toBe("custom");
    expect(body.theme.theme).toBe("base");
    expect(body.theme.variables.primaryColor).toBe("#d97757");
    expect(body.themes.some((entry) => entry.name === "meu-diagrama")).toBe(true);

    const file = join(themesDir, "meu-diagrama.mermaid.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(themesDir).some((name) => name.endsWith(".tmp"))).toBe(false);

    const duplicate = await fetch(`${base}/__mermaid-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper()),
    });
    expect(duplicate.status).toBe(409);

    const builtin = await fetch(`${base}/__mermaid-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("default")),
    });
    expect(builtin.status).toBe(409);
  }, 25000);

  it("resolves the custom theme from the cookie and falls back for unknown names", async () => {
    const { base, dir, token } = start();
    await fetch(`${base}/__mermaid-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper()),
    });
    const created = await fetch(`${base}/__register`, {
      method: "PUT",
      headers: { ...origin(base), "x-mdprv-token": token },
      body: JSON.stringify({ slug: "doc", path: join(dir, "doc.md"), content: "# Doc\n" }),
    });
    expect(created.status).toBe(200);

    const cookie = encodeURIComponent(
      JSON.stringify({
        v: 1,
        mermaid: { light: "meu-diagrama", dark: "meu-diagrama" },
      })
    );
    const html = await (
      await fetch(`${base}/doc`, { headers: { cookie: `mdprv_prefs=${cookie}` } })
    ).text();
    const data = payload(html);
    expect(data.mermaid.light.theme).toBe("base");
    expect(data.mermaid.light.themeVariables.primaryColor).toBe("#d97757");

    const unknown = encodeURIComponent(
      JSON.stringify({ v: 1, mermaid: { light: "nao-existe", dark: "nao-existe" } })
    );
    const fallbackRes = await fetch(`${base}/doc`, {
      headers: { cookie: `mdprv_prefs=${unknown}` },
    });
    expect(fallbackRes.status).toBe(200);
    const fallback = payload(await fallbackRes.text());
    expect(fallback.mermaid.light.theme).toBe("default");
  }, 25000);

  it("deletes only custom themes", async () => {
    const { base } = start();
    const builtin = await fetch(`${base}/__mermaid-themes/dark`, { method: "DELETE" });
    expect(builtin.status).toBe(403);

    await fetch(`${base}/__mermaid-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("removivel")),
    });
    const removed = await fetch(`${base}/__mermaid-themes/removivel`, {
      method: "DELETE",
      headers: origin(base),
    });
    expect(removed.status).toBe(204);

    const after = (await (await fetch(`${base}/__mermaid-themes`)).json()) as {
      themes: MermaidThemeEntry[];
    };
    expect(after.themes.some((entry) => entry.name === "removivel")).toBe(false);
  }, 25000);
});
