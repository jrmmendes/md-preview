import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createDaemon, type DaemonHandle } from "../src/application/daemon";
import type { Config } from "../src/core/config";
import type { IconPackEntry } from "../src/core/contract";

const dirs: string[] = [];
const daemons: DaemonHandle[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-icon-import-"));
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

function start(): { base: string; dir: string } {
  const dir = tempDir();
  const stateFile = join(dir, "state", "daemon.json");
  const daemon = createDaemon(makeConfig(stateFile), { heartbeatMs: 50 });
  daemons.push(daemon);
  return { base: `http://127.0.0.1:${daemon.port}`, dir };
}

function headers(base: string, json = true): Record<string, string> {
  return {
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function pack(name: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name,
    style: "symbolic",
    icons: { copy: `${name}/copy.svg` },
    ...overrides,
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

describe("icon import endpoints", () => {
  it("lists the builtin catalog and imports/removes a pack atomically", async () => {
    const { base, dir } = start();
    const iconsDir = join(dir, "icons");

    const list = await fetch(`${base}/__icons`);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { icons: IconPackEntry[]; errors: unknown[] };
    expect(listed.icons[0]?.name).toBe("breeze");
    expect(listed.icons[0]?.source).toBe("builtin");
    expect(listed.icons[0]?.default).toBe(true);
    expect(listed.icons[0]?.count).toBe(42);
    expect(listed.errors).toEqual([]);

    const created = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("custom", { label: "Custom" })),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { icon: IconPackEntry; icons: IconPackEntry[] };
    expect(body.icon).toEqual({
      name: "custom",
      label: "Custom",
      style: "symbolic",
      source: "user",
      count: 1,
    });
    expect(body.icons.some((entry) => entry.name === "custom")).toBe(true);

    const file = join(iconsDir, "custom.json");
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).name).toBe("custom");

    const removed = await fetch(`${base}/__icons/custom`, {
      method: "DELETE",
      headers: headers(base, false),
    });
    expect(removed.status).toBe(204);
    expect(existsSync(file)).toBe(false);
  }, 20000);

  it("rejects builtin names, duplicates and unknown icon keys", async () => {
    const { base } = start();

    const builtin = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("breeze")),
    });
    expect(builtin.status).toBe(409);

    const legacy = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("default")),
    });
    expect(legacy.status).toBe(409);
    expect(await legacy.text()).toContain("reserved");

    const created = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("custom")),
    });
    expect(created.status).toBe(201);

    const duplicate = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("custom")),
    });
    expect(duplicate.status).toBe(409);

    const invalid = await fetch(`${base}/__icons`, {
      method: "POST",
      headers: headers(base),
      body: JSON.stringify(pack("broken", { icons: { nope: "broken/nope.svg" } })),
    });
    expect(invalid.status).toBe(422);

    const removeBuiltin = await fetch(`${base}/__icons/breeze`, {
      method: "DELETE",
      headers: headers(base, false),
    });
    expect(removeBuiltin.status).toBe(403);

    const removeLegacy = await fetch(`${base}/__icons/default`, {
      method: "DELETE",
      headers: headers(base, false),
    });
    expect(removeLegacy.status).toBe(403);
    expect(await removeLegacy.text()).toContain("reserved");
  }, 20000);
});
