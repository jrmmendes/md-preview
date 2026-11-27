import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { EmojiPackEntry } from "../src/core/contract";
import type { EmojiPack } from "../src/core/emoji/types";
import { emojiSamples } from "../src/application/daemon/emoji-import";
import {
  parseEmojiEntries,
  parsePageThemeData,
} from "../src/ui/islands/settings/catalog";
import {
  isDraftDirty,
  needsReload,
  setDraftEmoji,
  type SettingsSnapshot,
} from "../src/ui/islands/settings/draft";
import {
  buildEmojiImportPayload,
  deriveEmojiName,
  emojiImportError,
  emojiSlugFromFile,
} from "../src/ui/islands/settings/previews/emoji-import";
import {
  emojiPackCredit,
  emojiPackMeta,
  emojiSampleView,
  emojiSamplesEndpoint,
  isUserEmojiPack,
  loadEmojiSamples,
  parseEmojiSamplesPayload,
} from "../src/ui/islands/settings/previews/emoji-preview";
import {
  parseSettingsRouteHash,
  sectionLabel,
} from "../src/ui/islands/settings/routes";

const THEME = {
  name: "auto",
  kind: "auto" as const,
  scheme: "light" as const,
  loaders: { light: "classic" as const, dark: "classic" as const },
  font: { family: "system-ui", stack: "system-ui, sans-serif" },
  shiki: { light: "github-light" as const, dark: "github-dark" as const },
  mermaidTheme: { light: "default" as const, dark: "dark" as const },
};

const PRESET = {
  loader: "classic" as const,
  font: { family: "system-ui", stack: "system-ui, sans-serif" },
  shiki: { light: "github-light" as const, dark: "github-dark" as const },
  mermaid: "default" as const,
};

const CATALOG = [
  {
    name: "auto",
    kind: "auto" as const,
    swatch: { background: "#fff", text: "#000", accent: "#08f" },
    presets: { light: PRESET, dark: PRESET },
  },
];

const GITHUB: EmojiPackEntry = {
  name: "github",
  label: "GitHub",
  description: "Shortcodes do GitHub.",
  style: "native",
  source: "builtin",
  count: 120,
  license: "CC-BY-4.0",
  attribution: "Nomes seguem a convenção do GitHub.",
};

const CUSTOM: EmojiPackEntry = {
  name: "custom",
  label: "Custom",
  style: "noto",
  source: "user",
  count: 2,
};

function payload(extra: Record<string, unknown> = {}) {
  return {
    theme: THEME,
    catalog: CATALOG,
    shikiThemes: [],
    emoji: { name: "github", style: "native" },
    emojis: [GITHUB],
    ...extra,
  };
}

function snapshot(emojiName = "github"): SettingsSnapshot {
  return {
    themeName: "auto",
    scheme: "light",
    blocks: { fonte: false, loader: false, codigo: false, graficos: false },
    stored: { font: null, loader: null, shiki: null, mermaid: null },
    emojiName,
    exampleId: "fluxo",
    zoom: 1.1,
    simpleTables: false,
    simpleDiffs: false,
    tableWrap: false,
  };
}

function pack(overrides: Partial<EmojiPack> = {}): EmojiPack {
  return {
    schemaVersion: 1,
    name: "sample",
    style: "native",
    shortcodes: { smile: "😄", rocket: "🚀" },
    id: "00000000",
    ...overrides,
  };
}

function source(path: string): string {
  return readFileSync(join(import.meta.dir, "../src/ui", path), "utf8");
}

function block(text: string, marker: string, end: string): string {
  const start = text.indexOf(marker);
  if (start < 0) {
    return "";
  }
  const stop = text.indexOf(end, start + marker.length);
  return stop < 0 ? text.slice(start) : text.slice(start, stop);
}

describe("settings emoji payload", () => {
  it("parses the active pack and the catalog", () => {
    const parsed = parsePageThemeData(
      payload({
        emojis: [GITHUB, CUSTOM],
        emoji: { name: "custom", style: "noto" },
      })
    );
    expect(parsed?.emoji).toEqual({ name: "custom", style: "noto" });
    expect(parsed?.emojis.map((entry) => entry.name)).toEqual(["github", "custom"]);
    expect(parsed?.emojis[1]?.source).toBe("user");
  });

  it("tolerates old pages without emoji fields", () => {
    const parsed = parsePageThemeData({
      theme: THEME,
      catalog: CATALOG,
      shikiThemes: [],
    });
    expect(parsed?.emoji).toBeNull();
    expect(parsed?.emojis).toEqual([]);
  });

  it("drops malformed entries and invalid active packs", () => {
    const parsed = parsePageThemeData(
      payload({
        emoji: { name: "github", style: "outro" },
        emojis: [
          GITHUB,
          { ...CUSTOM, style: "outro" },
          { ...CUSTOM, count: "2" },
          { ...CUSTOM, source: "disk" },
        ],
      })
    );
    expect(parsed?.emoji).toBeNull();
    expect(parsed?.emojis).toHaveLength(1);
    expect(parseEmojiEntries("nope")).toEqual([]);
  });

  it("keeps the read-only emojis path in the daemon config", () => {
    const config = {
      port: 8766,
      idleMinutes: 15,
      seedThemes: true,
      paths: {
        config: "/c/config.json",
        themes: "/c/themes",
        emojis: "/c/emojis",
        state: "/s/daemon.json",
      },
    };
    expect(parsePageThemeData(payload({ config }))?.config).toEqual(config);
    expect(
      parsePageThemeData(payload({ config: { ...config, paths: { ...config.paths, emojis: 1 } } }))
        ?.config
    ).toBeNull();
  });
});

describe("emoji draft", () => {
  it("moves the selection into the draft without applying it", () => {
    const applied = snapshot();
    const draft = setDraftEmoji(applied, "custom");
    expect(applied.emojiName).toBe("github");
    expect(draft.emojiName).toBe("custom");
    expect(isDraftDirty(applied, draft)).toBe(true);
  });

  it("reloads because shortcodes are expanded on the server", () => {
    const data = parsePageThemeData(payload());
    expect(data).not.toBeNull();
    expect(needsReload(snapshot(), snapshot("custom"), data!)).toBe(true);
    expect(needsReload(snapshot(), snapshot(), data!)).toBe(false);
  });
});

describe("emoji import helpers", () => {
  it("normalizes the slug, requires name and fills schemaVersion", () => {
    const result = buildEmojiImportPayload(
      JSON.stringify({ name: "Meu Pacote", shortcodes: { smile: "😄" } }),
      "Meu Pacote"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("meu-pacote");
      expect(result.value.schemaVersion).toBe(1);
      expect(result.value.shortcodes).toEqual({ smile: "😄" });
    }
    expect(buildEmojiImportPayload("", "x")).toEqual({
      ok: false,
      error: "Cole um emoji.json ou selecione um arquivo.",
    });
    expect(buildEmojiImportPayload("{", "x").ok).toBe(false);
    expect(buildEmojiImportPayload("[]", "x").ok).toBe(false);
    expect(buildEmojiImportPayload("{}", "  ").ok).toBe(false);
    expect(
      buildEmojiImportPayload("x".repeat(256 * 1024 + 1), "x").ok
    ).toBe(false);
  });

  it("derives names from the JSON and the file", () => {
    expect(deriveEmojiName({ name: "Meu Pacote" })).toBe("meu-pacote");
    expect(emojiSlugFromFile("meu-pacote.emoji.json")).toBe("meu-pacote");
    expect(emojiSlugFromFile("Meu Pacote.json")).toBe("meu-pacote");
    expect(emojiImportError(409, "")).toContain("Já existe");
    expect(emojiImportError(422, "")).toContain("inválido");
    expect(emojiImportError(403, "")).toContain("embutido");
  });
});

describe("emoji preview", () => {
  it("follows the renderer: data URI, pack SVG or native glyph", () => {
    expect(
      emojiSampleView({ name: "github", style: "native" }, { name: "smile", value: "😄" })
    ).toEqual({ kind: "text", text: "😄" });

    expect(
      emojiSampleView({ name: "custom", style: "noto" }, { name: "smile", value: "😄" })
    ).toEqual({
      kind: "image",
      src: "/__emoji-assets/custom/smile.svg",
      fallback: "😄",
    });

    expect(
      emojiSampleView(
        { name: "custom", style: "noto" },
        { name: "smile", value: "😄", asset: false }
      )
    ).toEqual({ kind: "text", text: "😄" });

    const data = "data:image/svg+xml;base64,PHN2Zy8+";
    expect(
      emojiSampleView({ name: "custom", style: "twemoji" }, { name: "svg", value: data })
    ).toEqual({ kind: "image", src: data, fallback: "" });
  });

  it("parses the lazy samples payload and rejects mismatches", () => {
    const body = {
      name: "github",
      style: "native",
      total: 120,
      samples: [{ name: "smile", value: "😄" }, { name: "bad" }],
    };
    expect(parseEmojiSamplesPayload(body)?.samples).toEqual([
      { name: "smile", value: "😄" },
    ]);
    expect(parseEmojiSamplesPayload(body, "custom")).toBeNull();
    expect(parseEmojiSamplesPayload({ ...body, style: "x" })).toBeNull();
    expect(emojiSamplesEndpoint("meu pacote")).toBe("/__emoji-samples/meu%20pacote");
  });

  it("loads samples lazily and degrades to null", async () => {
    const ok = await loadEmojiSamples("github", (async () =>
      new Response(
        JSON.stringify({ name: "github", style: "native", total: 1, samples: [{ name: "a1", value: "🅰️" }] }),
        { status: 200 }
      )) as unknown as typeof fetch);
    expect(ok?.samples).toHaveLength(1);

    const missing = await loadEmojiSamples("nope", (async () =>
      new Response("not found", { status: 404 })) as unknown as typeof fetch);
    expect(missing).toBeNull();
  });

  it("describes origin, counts and credits", () => {
    expect(isUserEmojiPack(GITHUB)).toBe(false);
    expect(isUserEmojiPack(CUSTOM)).toBe(true);
    expect(emojiPackMeta(CUSTOM)).toBe("custom · noto · 2 shortcodes · Usuário");
    expect(emojiPackMeta({ ...CUSTOM, count: 1 })).toContain("1 shortcode ·");
    expect(emojiPackCredit(GITHUB)).toBe(
      "CC-BY-4.0 — Nomes seguem a convenção do GitHub."
    );
    expect(emojiPackCredit(CUSTOM)).toBeNull();
  });

  it("bounds the server-side sample list", () => {
    const shortcodes: Record<string, string> = {};
    for (let index = 0; index < 40; index += 1) {
      shortcodes[`e${index}`] = "😄";
    }
    expect(emojiSamples(pack({ shortcodes }))).toHaveLength(24);

    const huge = `data:image/svg+xml;base64,${"A".repeat(33 * 1024)}`;
    const samples = emojiSamples(
      pack({ style: "twemoji", shortcodes: { big: huge, smile: "😄" } })
    );
    expect(samples.map((sample) => sample.name)).toEqual(["smile"]);
  });
});

describe("emojis settings wiring", () => {
  const index = source("islands/settings/index.ts");
  const page = source("islands/settings/pages/emojis.ts");

  it("adds Emojis as a top-level section", () => {
    expect(sectionLabel("emojis")).toBe("Emojis");
    expect(parseSettingsRouteHash("#/emojis")).toEqual({
      section: "emojis",
      anchor: null,
    });
    expect(parseSettingsRouteHash("#/emojis/extra")).toBeNull();
    expect(index).toContain('route.section === "emojis"');
  });

  it("keeps selection in the draft and never re-renders the page", () => {
    const select = block(index, "function selectEmoji", "\n  }");
    expect(select).toContain("setDraftEmoji(draft, name)");
    expect(select).toContain("updateDirty()");
    expect(select).not.toContain("render(");
    expect(select).not.toContain("setEmoji(");
    expect(page).toContain("ctx.selectEmoji(name)");
    expect(page).toContain("void refreshPreview()");
  });

  it("writes the cookie and clears ?emoji only on Save", () => {
    const apply = block(index, "async function applyDraft", "\n  function save()");
    expect(apply).toContain("setEmoji(target.emojiName)");
    expect(apply).toContain('url.searchParams.delete("emoji")');
    expect(index).not.toContain("setEmoji(draft");
  });

  it("imports into the catalog without touching the form or selection", () => {
    const imported = block(page, "onImported: (result) =>", "\n    onDeleted:");
    expect(imported).toContain("ctx.importedEmoji");
    expect(imported).toContain("renderList()");
    expect(imported).not.toContain("selectEmoji");
    expect(imported).not.toContain("replaceChildren");
    expect(page).toContain("renderImportPanel<EmojiPackEntry>");
    expect(page).toContain("readResponse");
  });

  it("removes only user packs, with confirmation", () => {
    const remove = block(page, "function removePack", "\n  function packRow");
    expect(remove).toContain("window.confirm");
    expect(remove).toContain('method: "DELETE"');
    const row = block(page, "function packRow", "\n  function renderList");
    expect(row).toContain("if (isUserEmojiPack(entry))");
    // Icon-only action nested in the pack card: no textual "Remover" button
    // sitting in a column next to it.
    expect(row).toContain("card.appendChild(");
    expect(row).not.toContain("row.appendChild(");
    expect(row).not.toContain('label: "Remover"');
    expect(row).toContain("mdprv-settings-emoji-pack-remove");
    expect(row).toContain('type: "button"');
    expect(row).toContain('icon("trash", 16)');
    expect(row).toContain("Remover ${entry.label}");
    expect(row).toContain('"aria-label"');
    expect(row).toContain("title:");
    // The built-in pack has no remove action at all: removal is created only
    // inside the user-pack guard.
    const guard = block(row, "if (isUserEmojiPack(entry))", "return card;");
    expect(guard).toContain("removePack(entry)");
  });

  it("sizes the in-card remove icon and keeps focus visible", () => {
    const css = source("styles/settings.css");
    const remove = block(css, ".mdprv-settings-emoji-pack-remove{", "\n");
    expect(remove).toContain("width:32px");
    expect(remove).toContain("height:32px");
    expect(block(css, ".mdprv-settings-emoji-pack-remove:focus-visible{", "\n"))
      .toContain("outline");
    expect(css).toContain(".mdprv-settings-emoji-pack.has-remove .mdprv-settings-emoji-pack-select");
  });

  it("turns a removed active pack into a dirty fallback, not a cookie write", () => {
    const ensure = block(index, "function ensureEmojiSelection", "\n  async function refreshEmojiCatalog");
    expect(ensure).toContain("setDraftEmoji(draft, fallback)");
    expect(ensure).not.toContain("applied =");
    const deleted = block(index, "function deletedEmoji", "\n  modal = createSettingsModal");
    expect(deleted).toContain("ensureEmojiSelection()");
    expect(deleted).toContain("clearEmoji()");
    expect(deleted).not.toContain("setEmoji(");
  });

  it("syncs the catalog in place on SSE", () => {
    expect(index).toContain('on("emojis", scheduleCatalogSync)');
    const sync = block(index, "async function syncCatalogs", "\n  function scheduleCatalogSync");
    expect(sync).toContain('fetch("/__emojis"');
    expect(sync).toContain("parseEmojiEntries(body.emojis)");
    expect(sync).toContain("emojisPage.update(state.data.emojis, draft.emojiName)");
  });

  it("shows the emojis path and resets the emoji cookie", () => {
    const sistema = source("islands/settings/pages/sistema.ts");
    expect(sistema).toContain('{ label: "Diretório de emojis", value: config.paths.emojis }');
    expect(sistema).toContain('"mdprv_emoji"');
    expect(sistema).toContain('url.searchParams.delete("emoji")');
  });
});
