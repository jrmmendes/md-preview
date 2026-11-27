import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { ThemeCatalogEntry } from "../src/core/contract";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-theme-import-"));
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

function colorTheme(name = "meu-tema", background = "#faf9f5") {
  return {
    $schema: "./theme.schema.json",
    schemaVersion: 1,
    name,
    kind: "light",
    colors: {
      background,
      surface: "#f5f4ed",
      text: "#141413",
      muted: "#5e5d59",
      border: "#e8e6dc",
      accent: "#d97757",
      "code-bg": "#f0eee6",
      quote: "#5e5d59",
    },
    shiki: { light: "github-light", dark: "github-light" },
    mermaid: { theme: "base", overrides: {} },
  };
}

describe("color theme import endpoints", () => {
  it("lists builtin + user catalog, imports and serves the theme", async () => {
    const { base, dir, token } = start();
    const themesDir = join(dir, "themes");

    const list = await fetch(`${base}/__themes`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as {
      themes: string[];
      catalog: ThemeCatalogEntry[];
      errors: unknown[];
    };
    expect(listed.themes[0]).toBe("auto");
    expect(listed.catalog.find((entry) => entry.name === "nord")?.source).toBe("builtin");
    expect(listed.catalog.every((entry) => entry.swatch.background.startsWith("#"))).toBe(true);

    const created = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme()),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      theme: ThemeCatalogEntry;
      themes: ThemeCatalogEntry[];
      errors: unknown[];
    };
    expect(body.theme.name).toBe("meu-tema");
    expect(body.theme.source).toBe("user");
    expect(body.theme.swatch.background).toBe("#faf9f5");
    expect(body.themes.some((entry) => entry.name === "meu-tema")).toBe(true);

    const file = join(themesDir, "meu-tema.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readdirSync(themesDir).some((name) => name.endsWith(".tmp"))).toBe(false);
    const saved = (await Bun.file(file).json()) as { name: string; $schema?: string };
    expect(saved.name).toBe("meu-tema");
    expect(saved.$schema).toBe("./theme.schema.json");

    const css = await fetch(`${base}/__theme-css?name=meu-tema`);
    expect(css.status).toBe(200);
    expect(await css.text()).toContain("--mdprv-bg:#faf9f5");

    const relisted = (await (await fetch(`${base}/__themes`)).json()) as {
      catalog: ThemeCatalogEntry[];
    };
    expect(relisted.catalog.find((entry) => entry.name === "meu-tema")?.source).toBe("user");

    const page = await fetch(`${base}/__register`, {
      method: "PUT",
      headers: { ...origin(base), "x-mdprv-token": token },
      body: JSON.stringify({ slug: "doc", path: join(dir, "doc.md"), content: "# Doc\n" }),
    });
    expect(page.status).toBe(200);
    const html = await (await fetch(`${base}/doc?theme=meu-tema`, {
      headers: { cookie: "x=1" },
    })).text();
    expect(html).toContain("--mdprv-bg:#faf9f5");
    expect(html).toContain('data-theme="meu-tema"');
    expect(token.length).toBeGreaterThan(0);
  }, 25000);

  it("rejects duplicates, builtin names, invalid themes and traversal", async () => {
    const { base } = start();
    const first = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme("meu-tema")),
    });
    expect(first.status).toBe(201);

    const duplicate = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme("meu-tema", "#ffffff")),
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.text()).toContain("already exists");

    const builtin = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme("nord")),
    });
    expect(builtin.status).toBe(409);
    expect(await builtin.text()).toContain("builtin");

    const invalid = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify({
        schemaVersion: 1,
        name: "quebrado",
        kind: "light",
        colors: { background: "white" },
      }),
    });
    expect(invalid.status).toBe(422);

    const traversal = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme("../evil")),
    });
    expect(traversal.status).toBe(422);

    const noOrigin = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(colorTheme("outro")),
    });
    expect(noOrigin.status).toBe(403);
  }, 25000);

  it("deletes only user themes", async () => {
    const { base } = start();
    const builtin = await fetch(`${base}/__themes/nord`, { method: "DELETE" });
    expect(builtin.status).toBe(403);

    const created = await fetch(`${base}/__themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(colorTheme("removivel")),
    });
    expect(created.status).toBe(201);

    const forbidden = await fetch(`${base}/__themes/removivel`, { method: "DELETE" });
    expect(forbidden.status).toBe(403);

    const removed = await fetch(`${base}/__themes/removivel`, {
      method: "DELETE",
      headers: origin(base),
    });
    expect(removed.status).toBe(204);

    const after = (await (await fetch(`${base}/__themes`)).json()) as {
      catalog: ThemeCatalogEntry[];
    };
    expect(after.catalog.some((entry) => entry.name === "removivel")).toBe(false);

    const missing = await fetch(`${base}/__themes/removivel`, {
      method: "DELETE",
      headers: origin(base),
    });
    expect(missing.status).toBe(404);
  }, 25000);
});
