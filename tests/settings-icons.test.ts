import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { IconPackEntry } from "../src/core/contract";
import { ICON_KEYS } from "../src/core/icons/constants";
import {
  parseIconEntries,
  parsePageThemeData,
} from "../src/ui/islands/settings/catalog";
import {
  isDraftDirty,
  needsReload,
  setDraftIcon,
  type SettingsSnapshot,
} from "../src/ui/islands/settings/draft";
import {
  buildIconImportPayload,
  deriveIconName,
  iconImportError,
  iconSlugFromFile,
} from "../src/ui/islands/settings/previews/icon-import";
import {
  iconPackCredit,
  iconPackMeta,
  iconPreviewKeys,
  iconPreviewSrc,
  iconSourceLabel,
  isDefaultIconPack,
  isUserIconPack,
} from "../src/ui/islands/settings/previews/icon-preview";
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

const BREEZE: IconPackEntry = {
  name: "breeze",
  label: "Breeze",
  description: "Pacote padrão embutido.",
  style: "symbolic",
  source: "builtin",
  count: ICON_KEYS.length,
  default: true,
  license: "LGPL-3.0-or-later",
  attribution: "Subconjunto Breeze.",
};

const CUSTOM: IconPackEntry = {
  name: "custom",
  label: "Custom",
  style: "fullcolor",
  source: "user",
  count: 3,
};

function payload(extra: Record<string, unknown> = {}) {
  return {
    theme: THEME,
    catalog: CATALOG,
    shikiThemes: [],
    icons: { name: "breeze", style: "symbolic" },
    iconPacks: [BREEZE],
    ...extra,
  };
}

function snapshot(iconName = "breeze"): SettingsSnapshot {
  return {
    themeName: "auto",
    scheme: "light",
    blocks: { fonte: false, loader: false, codigo: false, graficos: false },
    stored: { font: null, loader: null, shiki: null, mermaid: null },
    emojiName: "github",
    iconName,
    exampleId: "fluxo",
    zoom: 1.1,
    simpleTables: false,
    simpleDiffs: false,
    tableWrap: false,
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

describe("settings icon payload", () => {
  it("parses the active pack and the catalog", () => {
    const parsed = parsePageThemeData(
      payload({
        iconPacks: [BREEZE, CUSTOM],
        icons: { name: "custom", style: "fullcolor" },
      })
    );
    expect(parsed?.icons).toEqual({ name: "custom", style: "fullcolor" });
    expect(parsed?.iconPacks.map((entry) => entry.name)).toEqual([
      "breeze",
      "custom",
    ]);
    expect(parsed?.iconPacks[0]?.default).toBe(true);
    expect(parsed?.iconPacks[1]?.source).toBe("user");
  });

  it("tolerates old pages without icon fields", () => {
    const parsed = parsePageThemeData({
      theme: THEME,
      catalog: CATALOG,
      shikiThemes: [],
    });
    expect(parsed?.icons).toBeNull();
    expect(parsed?.iconPacks).toEqual([]);
  });

  it("drops malformed entries and invalid active packs", () => {
    const parsed = parsePageThemeData(
      payload({
        icons: { name: "breeze", style: "outro" },
        iconPacks: [
          BREEZE,
          { ...CUSTOM, style: "outro" },
          { ...CUSTOM, count: "2" },
          { ...CUSTOM, source: "disk" },
          { ...CUSTOM, default: "yes" },
        ],
      })
    );
    expect(parsed?.icons).toBeNull();
    expect(parsed?.iconPacks).toHaveLength(1);
    expect(parseIconEntries("nope")).toEqual([]);
  });

  it("keeps the read-only icons path in the daemon config", () => {
    const config = {
      port: 8766,
      idleMinutes: 15,
      seedThemes: true,
      paths: {
        config: "/c/config.json",
        themes: "/c/themes",
        emojis: "/c/emojis",
        icons: "/c/icons",
        state: "/s/daemon.json",
      },
    };
    expect(parsePageThemeData(payload({ config }))?.config).toEqual(config);
    expect(
      parsePageThemeData(payload({ config: { ...config, paths: { ...config.paths, icons: 1 } } }))
        ?.config
    ).toBeNull();
  });
});

describe("icon draft", () => {
  it("moves the selection into the draft without applying it", () => {
    const applied = snapshot();
    const draft = setDraftIcon(applied, "custom");
    expect(applied.iconName).toBe("breeze");
    expect(draft.iconName).toBe("custom");
    expect(isDraftDirty(applied, draft)).toBe(true);
  });

  it("reloads because the mask URLs are emitted with the page", () => {
    const data = parsePageThemeData(payload());
    expect(data).not.toBeNull();
    expect(needsReload(snapshot(), snapshot("custom"), data!)).toBe(true);
    expect(needsReload(snapshot(), snapshot(), data!)).toBe(false);
  });
});

describe("icon import helpers", () => {
  it("normalizes the slug, requires name and fills schemaVersion", () => {
    const result = buildIconImportPayload(
      JSON.stringify({ name: "Meu Pacote", icons: { copy: "x/copy.svg" } }),
      "Meu Pacote"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.name).toBe("meu-pacote");
      expect(result.value.schemaVersion).toBe(1);
      expect(result.value.icons).toEqual({ copy: "x/copy.svg" });
    }
    expect(buildIconImportPayload("", "x")).toEqual({
      ok: false,
      error: "Cole um icon.json ou selecione um arquivo.",
    });
    expect(buildIconImportPayload("{", "x").ok).toBe(false);
    expect(buildIconImportPayload("[]", "x").ok).toBe(false);
    expect(buildIconImportPayload("{}", "  ").ok).toBe(false);
    expect(buildIconImportPayload("x".repeat(256 * 1024 + 1), "x").ok).toBe(false);
  });

  it("derives names from the JSON and the file", () => {
    expect(deriveIconName({ name: "Meu Pacote" })).toBe("meu-pacote");
    expect(iconSlugFromFile("meu-pacote.icon.json")).toBe("meu-pacote");
    expect(iconSlugFromFile("Meu Pacote.json")).toBe("meu-pacote");
  });

  it("maps the known server errors", () => {
    expect(iconImportError(409, "")).toContain("Já existe");
    expect(iconImportError(422, "")).toContain("inválido");
    expect(iconImportError(413, "")).toContain("256 KiB");
    expect(iconImportError(415, "")).toContain("JSON");
    expect(iconImportError(403, "")).toContain("embutido");
  });
});

describe("icon preview", () => {
  it("describes origin, counts, credits and the default pack", () => {
    expect(isUserIconPack(BREEZE)).toBe(false);
    expect(isUserIconPack(CUSTOM)).toBe(true);
    expect(isDefaultIconPack(BREEZE)).toBe(true);
    expect(isDefaultIconPack(CUSTOM)).toBe(false);
    expect(iconSourceLabel(BREEZE)).toBe("Embutido");
    expect(iconSourceLabel(CUSTOM)).toBe("Usuário");
    expect(iconPackMeta(CUSTOM)).toBe("custom · fullcolor · 3 ícones · Usuário");
    expect(iconPackMeta({ ...CUSTOM, count: 1 })).toContain("1 ícone ·");
    expect(iconPackCredit(BREEZE)).toBe(
      "LGPL-3.0-or-later — Subconjunto Breeze."
    );
    expect(iconPackCredit(CUSTOM)).toBeNull();
  });

  it("exposes every known key with the selected pack URL", () => {
    expect(iconPreviewKeys()).toEqual(ICON_KEYS);
    expect(iconPreviewKeys()).toHaveLength(42);
    expect(iconPreviewSrc({ name: "custom" }, "copy")).toBe(
      "/__icon-assets/custom/copy.svg"
    );
  });
});

describe("icons settings wiring", () => {
  const index = source("islands/settings/index.ts");
  const page = source("islands/settings/pages/icons.ts");

  it("adds Ícones as a top-level section", () => {
    expect(sectionLabel("icons")).toBe("Ícones");
    expect(parseSettingsRouteHash("#/icons")).toEqual({
      section: "icons",
      anchor: null,
    });
    expect(parseSettingsRouteHash("#/icons/extra")).toBeNull();
    expect(index).toContain('route.section === "icons"');
  });

  it("keeps selection in the draft and never re-renders the page", () => {
    const select = block(index, "function selectIcon", "\n  }");
    expect(select).toContain("setDraftIcon(draft, name)");
    expect(select).toContain("updateDirty()");
    expect(select).not.toContain("render(");
    expect(select).not.toContain("setIcons(");
    expect(page).toContain("ctx.selectIcon(name)");
  });

  it("writes the cookie and clears ?icons only on Save", () => {
    const apply = block(index, "async function applyDraft", "\n  function save()");
    expect(apply).toContain("setIcons(target.iconName)");
    expect(apply).toContain('url.searchParams.delete("icons")');
    expect(index).not.toContain("setIcons(draft");
  });

  it("renders a live preview with .mdprv-icon and data-icon", () => {
    const preview = block(page, "function renderPreview", "\n  function select");
    expect(preview).toContain("iconPreviewKeys()");
    expect(preview).toContain('class: "mdprv-icon"');
    expect(preview).toContain("dataset: { icon: key }");
    expect(preview).toContain("iconPreviewSrc(entry, key)");
    // No fetch: selecting a pack repaints the grid before Save.
    expect(preview).not.toContain("fetch(");
    const select = block(page, "function select", "\n  function removePack");
    expect(select).toContain("renderPreview()");
    expect(select).not.toContain("await");
  });

  it("imports into the catalog without touching the form or selection", () => {
    const imported = block(page, "onImported: (result) =>", "\n    onDeleted:");
    expect(imported).toContain("ctx.importedIcon");
    expect(imported).toContain("renderList()");
    expect(imported).toContain("renderPreview()");
    expect(imported).not.toContain("selectIcon");
    expect(imported).not.toContain("replaceChildren");
    expect(page).toContain("renderImportPanel<IconPackEntry>");
    expect(page).toContain("readResponse");
    expect(page).toContain('endpoint: "/__icons"');
    expect(page).toContain("buildIconImportPayload");
    expect(page).toContain("iconImportError");
  });

  it("removes only user packs, with confirmation and an in-card trash icon", () => {
    const remove = block(page, "function removePack", "\n  function packRow");
    expect(remove).toContain("window.confirm");
    expect(remove).toContain('method: "DELETE"');
    const row = block(page, "function packRow", "\n  function renderList");
    expect(row).toContain("if (isUserIconPack(entry))");
    expect(row).toContain("card.appendChild(");
    expect(row).not.toContain("row.appendChild(");
    expect(row).not.toContain('label: "Remover"');
    expect(row).toContain("mdprv-settings-icon-pack-remove");
    expect(row).toContain('type: "button"');
    expect(row).toContain('icon("trash", 16)');
    expect(row).toContain("Remover ${entry.label}");
    expect(row).toContain('"aria-label"');
    expect(row).toContain("title:");
    // Builtin/default packs never receive the remove action.
    const guard = block(row, "if (isUserIconPack(entry))", "return card;");
    expect(guard).toContain("removePack(entry)");
    expect(row).toContain("isDefaultIconPack(entry)");
    expect(row).toContain('"padrão"');
  });

  it("sizes the in-card remove icon and keeps focus visible", () => {
    const css = source("styles/settings.css");
    const remove = block(css, ".mdprv-settings-icon-pack-remove{", "\n");
    expect(remove).toContain("width:32px");
    expect(remove).toContain("height:32px");
    expect(block(css, ".mdprv-settings-icon-pack-remove:focus-visible{", "\n"))
      .toContain("outline");
    expect(css).toContain(
      ".mdprv-settings-icon-pack.has-remove .mdprv-settings-icon-pack-select"
    );
  });

  it("turns a removed active pack into a dirty fallback, not a cookie write", () => {
    const ensure = block(index, "function ensureIconSelection", "\n  async function refreshIconCatalog");
    expect(ensure).toContain("setDraftIcon(draft, fallback)");
    expect(ensure).toContain("entry.default === true");
    expect(ensure).not.toContain("applied =");
    const deleted = block(index, "function deletedIcon", "\n  modal = createSettingsModal");
    expect(deleted).toContain("ensureIconSelection()");
    expect(deleted).toContain("clearIcons()");
    expect(deleted).not.toContain("setIcons(");
  });

  it("syncs the catalog in place on SSE", () => {
    expect(index).toContain('on("icons", scheduleCatalogSync)');
    const sync = block(index, "async function syncCatalogs", "\n  function scheduleCatalogSync");
    expect(sync).toContain('fetch("/__icons"');
    expect(sync).toContain("parseIconEntries(body.icons)");
    expect(sync).toContain("iconsPage.update(state.data.iconPacks, draft.iconName)");
  });

  it("shows the icons path and resets the icons cookie", () => {
    const sistema = source("islands/settings/pages/sistema.ts");
    expect(sistema).toContain('{ label: "Diretório de ícones", value: config.paths.icons }');
    expect(sistema).toContain('"mdprv_icons"');
    expect(sistema).toContain('url.searchParams.delete("icons")');
  });
});
