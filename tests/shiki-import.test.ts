import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { ShikiThemeEntry } from "../src/core/contract";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-shiki-import-"));
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

function start(): { base: string; dir: string; stateFile: string } {
  const dir = tempDir();
  const stateFile = join(dir, "state", "daemon.json");
  const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
  daemons.push(daemon);
  return { base: `http://127.0.0.1:${daemon.port}`, dir, stateFile };
}

function wrapper(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name,
    type: "dark",
    theme: {
      name,
      type: "dark",
      colors: { "editor.background": "#0b0e14", "editor.foreground": "#e6e6e6" },
      tokenColors: [{ scope: "source.ts", settings: { foreground: "#c0caf5" } }],
    },
    ...overrides,
  };
}

function origin(base: string): Record<string, string> {
  return {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json",
  };
}

describe("Shiki import endpoints", () => {
  it("lists builtins and imports a custom theme with an atomic 0600 file", async () => {
    const { base, dir } = start();
    const themesDir = join(dir, "themes");

    const list = await fetch(`${base}/__shiki-themes`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { themes: ShikiThemeEntry[]; errors: unknown[] };
    expect(listed.themes).toHaveLength(65);
    expect(listed.themes.every((theme) => theme.source === "builtin")).toBe(true);
    expect(listed.errors).toEqual([]);

    const created = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("minha-paleta")),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      theme: ShikiThemeEntry;
      preview: { light: { html: string }; dark: { html: string } };
      themes: ShikiThemeEntry[];
    };
    expect(body.theme).toEqual({
      name: "minha-paleta",
      label: "Minha Paleta",
      kind: "dark",
      source: "custom",
    });
    expect(body.preview.dark.html).toContain('<pre class="shiki');
    expect(body.preview.dark.html).toContain("--shiki-dark");
    expect(body.themes.some((theme) => theme.name === "minha-paleta")).toBe(true);

    const file = join(themesDir, "minha-paleta.shiki.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const content = JSON.parse(await Bun.file(file).text()) as { schemaVersion: number; name: string };
    expect(content.schemaVersion).toBe(1);
    expect(content.name).toBe("minha-paleta");

    const listedAgain = (await (await fetch(`${base}/__shiki-themes`)).json()) as {
      themes: ShikiThemeEntry[];
    };
    expect(listedAgain.themes.map((theme) => theme.name)).toContain("minha-paleta");

    const preview = await fetch(`${base}/__preview/code?theme=minha-paleta&lang=ts`);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { html: string; background: string };
    expect(previewBody.html).toContain("--shiki-light");
    expect(previewBody.background).toBe("#0b0e14");
  }, 25000);

  it("rejects duplicates, builtin names and invalid colors", async () => {
    const { base } = start();
    const first = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("minha-paleta")),
    });
    expect(first.status).toBe(201);

    const duplicate = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("minha-paleta")),
    });
    expect(duplicate.status).toBe(409);

    const builtin = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("nord")),
    });
    expect(builtin.status).toBe(409);

    const badColor = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(
        wrapper("outra-paleta", {
          theme: { colors: { "editor.background": "url(evil)" } },
        })
      ),
    });
    expect(badColor.status).toBe(422);
  }, 25000);

  it("enforces origin, content type and body size", async () => {
    const { base } = start();
    const payload = JSON.stringify(wrapper("segura"));

    const noOrigin = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    });
    expect(noOrigin.status).toBe(403);

    const foreignOrigin = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: {
        Origin: "https://evil.test",
        "Content-Type": "application/json",
      },
      body: payload,
    });
    expect(foreignOrigin.status).toBe(403);

    const wrongType = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "text/plain" },
      body: payload,
    });
    expect(wrongType.status).toBe(415);

    const tooLarge = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify({ ...wrapper("grande"), pad: "x".repeat(300 * 1024) }),
    });
    expect(tooLarge.status).toBe(413);

    const preview = await fetch(`${base}/__shiki-themes/preview`, {
      method: "POST",
      headers: { Origin: base, "Content-Type": "text/plain" },
      body: payload,
    });
    expect(preview.status).toBe(415);
  }, 25000);

  it("previews without writing and deletes only existing custom themes", async () => {
    const { base, dir } = start();
    const themesDir = join(dir, "themes");
    const preview = await fetch(`${base}/__shiki-themes/preview`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("so-previa")),
    });
    expect(preview.status).toBe(200);
    expect(existsSync(themesDir) ? readdirSync(themesDir).length : 0).toBe(0);

    const created = await fetch(`${base}/__shiki-themes`, {
      method: "POST",
      headers: origin(base),
      body: JSON.stringify(wrapper("removivel")),
    });
    expect(created.status).toBe(201);
    const file = join(themesDir, "removivel.shiki.json");
    expect(existsSync(file)).toBe(true);

    const forbidden = await fetch(`${base}/__shiki-themes/removivel`, { method: "DELETE" });
    expect(forbidden.status).toBe(403);

    const removed = await fetch(`${base}/__shiki-themes/removivel`, {
      method: "DELETE",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    expect(removed.status).toBe(204);
    expect(existsSync(file)).toBe(false);

    const after = (await (await fetch(`${base}/__shiki-themes`)).json()) as {
      themes: ShikiThemeEntry[];
    };
    expect(after.themes.some((theme) => theme.name === "removivel")).toBe(false);
    expect((await fetch(`${base}/__preview/code?theme=removivel`)).status).toBe(400);

    const missing = await fetch(`${base}/__shiki-themes/removivel`, {
      method: "DELETE",
      headers: { Origin: base, "Sec-Fetch-Site": "same-origin" },
    });
    expect(missing.status).toBe(404);
  }, 25000);
});
