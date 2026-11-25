import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMermaidThemeStore } from "../src/core/themes/mermaid-store";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-mermaid-store-"));
  dirs.push(dir);
  return dir;
}

function theme(name: string, color = "#d97757") {
  return {
    schemaVersion: 1,
    name,
    theme: "base",
    variables: { primaryColor: color },
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Mermaid theme store", () => {
  it("loads, changes and removes custom files with signatures", () => {
    const dir = tempDir();
    const file = join(dir, "meu-diagrama.mermaid.json");
    writeFileSync(file, JSON.stringify(theme("meu-diagrama")));
    const store = createMermaidThemeStore({ dir, watch: false });
    expect(store.names()).toEqual(["meu-diagrama"]);
    expect(store.get("meu-diagrama")?.variables.primaryColor).toBe("#d97757");
    expect(store.list()[0]).toMatchObject({
      name: "meu-diagrama",
      label: "Meu Diagrama",
      source: "custom",
      theme: "base",
    });

    writeFileSync(file, JSON.stringify(theme("meu-diagrama", "#101820")));
    const changed = store.refresh(true);
    expect(changed?.changed).toEqual(["meu-diagrama"]);
    expect(store.get("meu-diagrama")?.variables.primaryColor).toBe("#101820");

    unlinkSync(file);
    const removed = store.refresh(true);
    expect(removed?.changed).toEqual(["meu-diagrama"]);
    expect(store.names()).toEqual([]);
    store.close();
  });

  it("reports invalid files without dropping valid ones", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "bom.mermaid.json"), JSON.stringify(theme("bom")));
    writeFileSync(
      join(dir, "ruim.mermaid.json"),
      JSON.stringify(theme("ruim", "url(evil)"))
    );
    const store = createMermaidThemeStore({ dir, watch: false });
    expect(store.names()).toEqual(["bom"]);
    expect(store.errors().length).toBe(1);
    store.close();
  });
});
