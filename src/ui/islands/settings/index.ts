/**
 * Entrada do modal de configurações.
 *
 * `applied` é o estado efetivo da página; `draft` é o rascunho em memória que as
 * páginas editam. Nada toca o documento, cookies ou `localStorage` antes de
 * salvar: `Save` (ou `Ctrl/Cmd+S`) aplica o rascunho de uma vez e, quando Shiki,
 * Mermaid ou o tema mudaram, dispara o reload único com o loader e reabre o
 * modal na mesma rota. Fechar sem salvar descarta o rascunho.
 */
import type { LoaderName } from "../../../core/loader";
import type { MermaidThemeName, ShikiThemeName } from "../../../core/themes/constants";
import type {
  EmojiPackEntry,
  MermaidThemeEntry,
  ShikiThemeEntry,
} from "../../../core/contract";
import type { FontPickerValue } from "../font-picker";
import {
  getSimpleDiffs,
  getSimpleTables,
  getTableWrap,
  clearEmoji,
  setEmoji,
  setSimpleDiffs,
  setSimpleTables,
  setTableWrap,
  setTheme,
  setZoomSensitivity,
  writeLoaderIntent,
} from "../../prefs";
import { on } from "../../services/events";
import {
  applyFontValue,
  applyLoaderValue,
  applyThemeCss,
  applyThemeName,
  clearDirtyRender,
  fetchThemeCss,
  hasDocumentOpen,
  prefersDark,
  schemeForKind,
} from "../../services/theme-runtime";
import {
  entryScheme,
  findCatalogEntry,
  parseEmojiEntries,
  parsePageThemeData,
  resolvePresets,
  sanitizeMermaidValue,
  sanitizeShikiValue,
  themeLabel,
  type BlockId,
  type MermaidValue,
  type PageThemeData,
  type ShikiValue,
} from "./catalog";
import {
  readBlocks,
  readStoredValues,
  writeBlocks,
  writeFontValue,
  writeLoaderValue,
  writeMermaidValue,
  writeShikiValue,
} from "./overrides";
import {
  DEFAULT_ROUTE,
  parseSettingsRouteString,
  settingsRouteString,
  type SettingsRoute,
  type WidgetAnchor,
} from "./routes";
import { toast } from "./components";
import {
  CHART_EXAMPLES,
  DEFAULT_CHART_EXAMPLE,
  chartExample,
  type ChartsPreviewHandle,
} from "./previews/charts";
import {
  cloneSnapshot,
  commitSnapshot,
  discardSnapshot,
  effectiveBlocks,
  isDraftDirty,
  needsReload,
  restoreDraftBlock,
  setDraftCustomized,
  setDraftEmoji,
  setDraftExample,
  setDraftFont,
  setDraftLoader,
  setDraftMermaid,
  setDraftShiki,
  setDraftSimpleDiffs,
  setDraftSimpleTables,
  setDraftTableWrap,
  setDraftTheme,
  setDraftZoom,
  type SettingsSnapshot,
} from "./draft";
import { formatZoom, currentZoom } from "./pages/widgets";
import {
  WIDGET_PREVIEW_CLASSES,
  widgetPreviewClasses,
  type WidgetPreviewTarget,
} from "./previews/widget-classes";
import {
  renderAppearancePage,
  type AppearanceContext,
  type AppearancePageHandle,
} from "./pages/aparencia";
import { renderImportPage } from "./pages/importar";
import {
  renderEmojisPage,
  type EmojisPageHandle,
} from "./pages/emojis";
import { clearCodePreviewCache } from "./previews/code";
import type { EmojiImportResult } from "./previews/emoji-import";
import type { ShikiImportResult } from "./previews/shiki-import";
import type { ThemeImportResult } from "./previews/theme-import";
import type { MermaidImportResult } from "./previews/mermaid-import";
import { renderSistemaPage } from "./pages/sistema";
import { renderThemesPage } from "./pages/temas";
import { renderWidgetsPage } from "./pages/widgets";
import { createSettingsModal, type SettingsModalHandle } from "./modal";

const LAST_ROUTE_KEY = "mdprv_settings_last_route";
const OPEN_KEY = "mdprv_settings_open";
const EXAMPLE_KEY = "mdprv_settings_chart_example";

/** Falls back to the default when storage is blocked or holds an old id. */
function lastExample(): string {
  const stored = sessionGet(EXAMPLE_KEY);
  return stored !== null && CHART_EXAMPLES.some((example) => example.id === stored)
    ? stored
    : DEFAULT_CHART_EXAMPLE;
}

/** A CSS selector that still finds the node after the content is rebuilt. */
function focusPath(node: HTMLElement | null): string {
  if (!node || node === document.body || !node.isConnected) {
    return "";
  }
  if (node.id !== "") {
    return `#${CSS.escape(node.id)}`;
  }
  const parts: string[] = [];
  let current: HTMLElement | null = node;
  while (current && current !== document.body) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) {
      return "";
    }
    const index = Array.prototype.indexOf.call(parent.children, current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    current = parent;
  }
  return parts.join(" > ");
}

interface CatalogState {
  data: PageThemeData;
  shikiThemes: ShikiThemeEntry[];
  mermaidThemes: MermaidThemeEntry[];
}

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

function sessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function readPayload(): PageThemeData | null {
  const node = document.getElementById("mdprv-data");
  const raw = node?.textContent;
  if (!raw) {
    return null;
  }
  try {
    return parsePageThemeData(JSON.parse(raw));
  } catch {
    return null;
  }
}

function lastRoute(): SettingsRoute {
  const stored = parseSettingsRouteString(sessionGet(LAST_ROUTE_KEY));
  return stored ?? DEFAULT_ROUTE;
}

function blockFocus(block: BlockId): string {
  return `.mdprv-settings-block[data-block="${block}"] .mdprv-settings-block-action[data-action="customize"]`;
}

export function initSettings(): void {
  const root = document.getElementById("mdprv-settings-root");
  const trigger = document.getElementById("mdprv-settings-toggle");
  const data = readPayload();
  if (!root || !data) {
    return;
  }

  const initialEntry = findCatalogEntry(data, data.theme.name);
  const scheme = initialEntry
    ? entryScheme(initialEntry, prefersDark())
    : data.theme.scheme;

  const state: CatalogState = {
    data,
    shikiThemes: data.shikiThemes,
    mermaidThemes: data.mermaidThemes ?? [],
  };

  let applied: SettingsSnapshot = {
    themeName: initialEntry?.name ?? data.theme.name,
    scheme,
    blocks: readBlocks(),
    stored: readStoredValues(),
    emojiName:
      data.emoji?.name ??
      data.emojis.find((entry) => entry.name === "github")?.name ??
      data.emojis[0]?.name ??
      "github",
    exampleId: lastExample(),
    zoom: currentZoom(),
    simpleTables: getSimpleTables(),
    simpleDiffs: getSimpleDiffs(),
    tableWrap: getTableWrap(),
  };
  let draft: SettingsSnapshot = cloneSnapshot(applied);

  let modal: SettingsModalHandle;
  let saving = false;
  let committing = false;
  let chartsPreview: ChartsPreviewHandle | null = null;
  let appearancePage: AppearancePageHandle | null = null;
  let emojisPage: EmojisPageHandle | null = null;

  function presetsFor(snapshot: SettingsSnapshot) {
    return resolvePresets(state.data, snapshot.themeName, snapshot.scheme);
  }

  function openImportPage(): void {
    if (
      modal.currentRoute().section === "temas" &&
      modal.currentRoute().anchor === "importar"
    ) {
      return;
    }
    modal.navigate({ section: "temas", anchor: "importar" });
  }

  function updateDirty(): void {
    modal.setDirty(isDraftDirty(applied, draft));
  }

  /**
   * The Widgets toggles preview live, but the classes stay on the preview
   * wrapper: the real document behind the modal (and the table island that
   * watches `<html>` for these classes) is never touched.
   */
  function syncWidgetPreviewClasses(snapshot: SettingsSnapshot): void {
    const nodes = document.querySelectorAll<HTMLElement>("[data-preview]");
    for (const node of nodes) {
      const target: WidgetPreviewTarget =
        node.dataset.preview === "diffs" ? "diffs" : "tables";
      node.classList.remove(...WIDGET_PREVIEW_CLASSES);
      node.classList.add(...widgetPreviewClasses(target, snapshot));
    }
  }

  function appearanceContext(): AppearanceContext | null {
    const resolved = effectiveBlocks(state.data, draft);
    if (!resolved) {
      return null;
    }
    return {
      blocks: draft.blocks,
      resolved,
      exampleId: draft.exampleId,
      toggleBlock,
      restoreBlock,
      changeFont,
      changeLoader,
      changeShiki,
      changeMermaid,
      changeExample,
      openImportPage,
      shikiThemes: state.shikiThemes,
      mermaidThemes: state.mermaidThemes,
      registerChartsPreview: (handle) => {
        chartsPreview = handle;
      },
    };
  }

  function render(route: SettingsRoute, focusSelector?: string): void {
    if (!effectiveBlocks(state.data, draft)) {
      return;
    }
    chartsPreview = null;
    appearancePage = null;
    emojisPage = null;

    let content: HTMLElement;
    if (route.section === "temas") {
      if (route.anchor === "importar") {
        content = renderImportPage({
          catalog: state.data.catalog,
          shikiThemes: state.shikiThemes,
          mermaidThemes: state.mermaidThemes,
          onThemeImported: importedTheme,
          onThemeDeleted: deletedTheme,
          onShikiImported: importedShiki,
          onShikiDeleted: deletedShiki,
          onMermaidImported: importedMermaid,
          onMermaidDeleted: deletedMermaid,
        });
      } else {
        content = renderThemesPage({
          data: state.data,
          themeName: draft.themeName,
          selectTheme: (name) => {
            selectTheme(name);
          },
          openImportPage,
        });
      }
    } else if (route.section === "aparencia") {
      const context = appearanceContext();
      if (!context) {
        return;
      }
      appearancePage = renderAppearancePage(context);
      content = appearancePage.root;
    } else if (route.section === "emojis") {
      emojisPage = renderEmojisPage({
        emojis: state.data.emojis,
        emojiName: draft.emojiName,
        selectEmoji,
        importedEmoji,
        deletedEmoji,
      });
      content = emojisPage.root;
    } else if (route.section === "sistema") {
      content = renderSistemaPage(state.data.config ?? null);
    } else {
      content = renderWidgetsPage({
        anchor: route.anchor as WidgetAnchor | null,
        zoom: draft.zoom,
        simpleTables: draft.simpleTables,
        simpleDiffs: draft.simpleDiffs,
        tableWrap: draft.tableWrap,
        onZoom: changeZoom,
        onSimpleTables: changeSimpleTables,
        onSimpleDiffs: changeSimpleDiffs,
        onTableWrap: changeTableWrap,
      });
    }

    modal.render(content, route);
    syncWidgetPreviewClasses(draft);
    sessionSet(LAST_ROUTE_KEY, settingsRouteString(route));
    updateDirty();

    if (focusSelector) {
      document.querySelector<HTMLElement>(focusSelector)?.focus();
    }
    if (route.section === "widgets" && route.anchor) {
      requestAnimationFrame(() => modal.scrollToAnchor(route.anchor as string));
    }
  }

  /** Re-renders the current page without losing the scroll position or focus. */
  function renderPreservingView(route: SettingsRoute): void {
    const container = document.getElementById("mdprv-settings-scroll");
    const top = container?.scrollTop ?? 0;
    const focus = focusPath(document.activeElement as HTMLElement | null);
    render(route);
    if (container) {
      container.scrollTop = top;
    }
    if (focus !== "") {
      document.querySelector<HTMLElement>(focus)?.focus();
    }
  }

  function selectTheme(name: string): void {
    const entry = findCatalogEntry(state.data, name);
    if (!entry) {
      return;
    }
    // `themeGrid` already synced the selected card; rebuilding the page here
    // would only reset the modal scroll and destroy the focused card.
    draft = setDraftTheme(draft, name, entryScheme(entry, prefersDark()));
    updateDirty();
  }

  /**
   * The list already moved the radio in-place; changing the pack must not
   * re-render the page (it would reset the preview and any typed JSON).
   */
  function selectEmoji(name: string): void {
    if (!state.data.emojis.some((entry) => entry.name === name)) {
      return;
    }
    draft = setDraftEmoji(draft, name);
    updateDirty();
  }

  /** Rebuilds a single appearance block instead of the whole page/form. */
  function updateAppearanceBlock(block: BlockId): void {
    const context = appearanceContext();
    if (!context || !appearancePage) {
      renderPreservingView(modal.currentRoute());
      return;
    }
    appearancePage.updateBlock(block, context);
    document.querySelector<HTMLElement>(blockFocus(block))?.focus();
  }

  function toggleBlock(block: BlockId, enabled: boolean): void {
    const presets = presetsFor(draft);
    if (!presets) {
      return;
    }
    draft = setDraftCustomized(draft, block, enabled, presets, draft.scheme);
    updateDirty();
    updateAppearanceBlock(block);
  }

  function restoreBlock(block: BlockId): void {
    const presets = presetsFor(draft);
    if (!presets) {
      return;
    }
    draft = restoreDraftBlock(draft, block, presets, draft.scheme);
    updateDirty();
    updateAppearanceBlock(block);
  }

  function changeFont(value: FontPickerValue): void {
    if (value.family === "") {
      draft = setDraftFont(draft, null);
    } else if (value.source === "google") {
      draft = setDraftFont(draft, {
        family: value.family,
        stack: value.stack,
        source: "google",
      });
    } else {
      draft = setDraftFont(draft, {
        family: value.family,
        stack: value.stack,
        source: "local",
      });
    }
    updateDirty();
  }

  function changeLoader(value: LoaderName): void {
    draft = setDraftLoader(draft, value);
    updateDirty();
  }

  function changeShiki(face: "light" | "dark", value: ShikiThemeName): void {
    if (!state.shikiThemes.some((theme) => theme.name === value)) {
      return;
    }
    const presets = presetsFor(draft);
    if (!presets) {
      return;
    }
    const base: ShikiValue =
      draft.blocks.codigo && draft.stored.shiki
        ? draft.stored.shiki
        : {
            light: presets.light.shiki.light,
            dark: presets.dark.shiki.dark,
          };
    draft = setDraftShiki(draft, { ...base, [face]: value });
    updateDirty();
  }

  function changeMermaid(face: "light" | "dark", value: MermaidThemeName): void {
    if (!state.mermaidThemes.some((theme) => theme.name === value)) {
      return;
    }
    const presets = presetsFor(draft);
    if (!presets) {
      return;
    }
    const base: MermaidValue =
      draft.blocks.graficos && draft.stored.mermaid
        ? draft.stored.mermaid
        : {
            light: presets.light.mermaid,
            dark: presets.dark.mermaid,
          };
    draft = setDraftMermaid(draft, { ...base, [face]: value });
    updateDirty();
  }

  function changeExample(id: string): void {
    // Live view preference: repaint the charts only, never the whole modal.
    // It is tracked outside the dirty comparison, so the baseline follows it.
    draft = setDraftExample(draft, id);
    applied = setDraftExample(applied, id);
    sessionSet(EXAMPLE_KEY, id);
    chartsPreview?.setExample(id);
    const menu = document.querySelector<HTMLElement>(
      ".mdprv-settings-chart-example .mdprv-settings-icon-menu-button"
    );
    if (menu) {
      const label = `Exemplo de diagrama: ${chartExample(id).label}`;
      menu.setAttribute("aria-label", label);
      menu.setAttribute("title", label);
    }
    updateDirty();
  }

  function changeZoom(value: number): void {
    draft = setDraftZoom(draft, value);
    updateDirty();
  }

  function changeSimpleTables(value: boolean): void {
    draft = setDraftSimpleTables(draft, value);
    updateDirty();
    syncWidgetPreviewClasses(draft);
  }

  function changeSimpleDiffs(value: boolean): void {
    draft = setDraftSimpleDiffs(draft, value);
    updateDirty();
    syncWidgetPreviewClasses(draft);
  }

  function changeTableWrap(value: boolean): void {
    draft = setDraftTableWrap(draft, value);
    updateDirty();
    syncWidgetPreviewClasses(draft);
  }

  async function applyDraft(target: SettingsSnapshot): Promise<void> {
    const themeChanged = applied.themeName !== target.themeName;
    const schemeChanged = applied.scheme !== target.scheme;
    const resolved = effectiveBlocks(state.data, target);

    if (themeChanged) {
      setTheme(target.themeName);
      const url = new URL(location.href);
      if (url.searchParams.has("theme")) {
        url.searchParams.delete("theme");
        history.replaceState(history.state, "", `${url.pathname}${url.search}${location.hash}`);
      }
      const css = await fetchThemeCss(target.themeName);
      if (css) {
        applyThemeCss(css);
      }
    }
    if (themeChanged || schemeChanged) {
      applyThemeName(target.themeName, target.scheme);
    }

    if (applied.emojiName !== target.emojiName) {
      setEmoji(target.emojiName);
      // Drop an explicit `?emoji=` so the saved cookie wins on reload.
      const url = new URL(location.href);
      if (url.searchParams.has("emoji")) {
        url.searchParams.delete("emoji");
        history.replaceState(
          history.state,
          "",
          `${url.pathname}${url.search}${location.hash}`
        );
      }
    }

    writeBlocks(target.blocks);
    writeFontValue(target.stored.font);
    writeLoaderValue(target.stored.loader);
    writeShikiValue(target.stored.shiki);
    writeMermaidValue(target.stored.mermaid);

    if (resolved) {
      applyFontValue(resolved.fonte.customized ? resolved.fonte.value : null);
      applyLoaderValue(resolved.loader.value);
    } else {
      applyFontValue(null);
    }

    setZoomSensitivity(target.zoom);
    document.documentElement.setAttribute("data-zoom-sensitivity", formatZoom(target.zoom));
    setSimpleTables(target.simpleTables);
    setSimpleDiffs(target.simpleDiffs);
    setTableWrap(target.tableWrap);
    document.documentElement.classList.toggle("mdprv-simple-tables", target.simpleTables);
    document.documentElement.classList.toggle("mdprv-simple-diffs", target.simpleDiffs);
    document.documentElement.classList.toggle("mdprv-wrap-cells", target.tableWrap);
  }

  function save(): void {
    if (!modal.isOpen() || saving || !isDraftDirty(applied, draft)) {
      return;
    }
    saving = true;
    const target = cloneSnapshot(draft);
    const route = modal.currentRoute();
    const reload = needsReload(applied, target, state.data);
    void (async () => {
      await applyDraft(target);
      applied = commitSnapshot(applied, target);
      draft = cloneSnapshot(applied);
      modal.setDirty(false);
      saving = false;
      committing = true;
      if (reload && hasDocumentOpen()) {
        sessionSet(OPEN_KEY, settingsRouteString(route));
        writeLoaderIntent(window.location.pathname);
        modal.close();
        committing = false;
        window.location.reload();
        return;
      }
      modal.close();
      committing = false;
    })();
  }

  function refreshThemeCatalog(): Promise<boolean> {
    return (async () => {
      try {
        const response = await fetch("/__themes", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) {
          return false;
        }
        const body = (await response.json()) as { catalog?: unknown };
        if (!Array.isArray(body.catalog)) {
          return false;
        }
        const next = parsePageThemeData({
          ...state.data,
          catalog: body.catalog,
        });
        if (!next) {
          return false;
        }
        state.data.catalog = next.catalog;
        return true;
      } catch {
        return false;
      }
    })();
  }

  function importedTheme(result: ThemeImportResult): void {
    state.data.catalog =
      result.themes.length > 0
        ? result.themes
        : [
            ...state.data.catalog.filter((entry) => entry.name !== result.theme.name),
            result.theme,
          ];
    toast(`Tema importado: ${themeLabel(result.theme.name)}`);
  }

  function deletedTheme(name: string): void {
    void (async () => {
      const ok = await refreshThemeCatalog();
      if (!ok) {
        return;
      }
      const fallback =
        findCatalogEntry(state.data, "auto") ?? state.data.catalog[0];
      if (!findCatalogEntry(state.data, draft.themeName) && fallback) {
        draft = setDraftTheme(
          draft,
          fallback.name,
          entryScheme(fallback, prefersDark())
        );
      }
      if (!findCatalogEntry(state.data, applied.themeName) && fallback) {
        applied = setDraftTheme(
          applied,
          fallback.name,
          entryScheme(fallback, prefersDark())
        );
      }
      toast(`Tema removido: ${themeLabel(name)}`);
      updateDirty();
    })();
  }

  function importedShiki(result: ShikiImportResult): void {
    state.shikiThemes =
      result.themes.length > 0
        ? result.themes
        : [
            ...state.shikiThemes.filter((entry) => entry.name !== result.theme.name),
            result.theme,
          ];
    state.data.shikiThemes = state.shikiThemes;
    clearCodePreviewCache();
    toast(`Tema Shiki importado: ${result.theme.label}`);
  }

  function sanitizeSnapshotsShiki(themes: ShikiThemeEntry[]): void {
    if (draft.stored.shiki) {
      const next = sanitizeShikiValue(draft.stored.shiki, themes);
      if (
        next.light !== draft.stored.shiki.light ||
        next.dark !== draft.stored.shiki.dark
      ) {
        draft = setDraftShiki(draft, next);
      }
    }
    if (applied.stored.shiki) {
      const next = sanitizeShikiValue(applied.stored.shiki, themes);
      if (
        next.light !== applied.stored.shiki.light ||
        next.dark !== applied.stored.shiki.dark
      ) {
        applied = setDraftShiki(applied, next);
      }
    }
  }

  function deletedShiki(name: string): void {
    void (async () => {
      try {
        const response = await fetch("/__shiki-themes", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { themes?: unknown };
        if (!Array.isArray(body.themes)) {
          return;
        }
        const themes = body.themes.filter(
          (entry): entry is ShikiThemeEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { name?: unknown }).name === "string" &&
            typeof (entry as { label?: unknown }).label === "string"
        );
        state.shikiThemes = themes;
        state.data.shikiThemes = themes;
        clearCodePreviewCache();
        sanitizeSnapshotsShiki(themes);
        toast(`Tema Shiki removido: ${name}`);
        updateDirty();
      } catch {
        /* keep the current UI on failure */
      }
    })();
  }

  function importedMermaid(result: MermaidImportResult): void {
    state.mermaidThemes =
      result.themes.length > 0
        ? result.themes
        : [
            ...state.mermaidThemes.filter((entry) => entry.name !== result.theme.name),
            result.theme,
          ];
    state.data.mermaidThemes = state.mermaidThemes;
    toast(`Tema Mermaid importado: ${result.theme.label}`);
  }

  function sanitizeSnapshotsMermaid(themes: MermaidThemeEntry[]): void {
    if (draft.stored.mermaid) {
      const next = sanitizeMermaidValue(draft.stored.mermaid, themes);
      if (
        next.light !== draft.stored.mermaid.light ||
        next.dark !== draft.stored.mermaid.dark
      ) {
        draft = setDraftMermaid(draft, next);
      }
    }
    if (applied.stored.mermaid) {
      const next = sanitizeMermaidValue(applied.stored.mermaid, themes);
      if (
        next.light !== applied.stored.mermaid.light ||
        next.dark !== applied.stored.mermaid.dark
      ) {
        applied = setDraftMermaid(applied, next);
      }
    }
  }

  function deletedMermaid(name: string): void {
    void (async () => {
      try {
        const response = await fetch("/__mermaid-themes", {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { themes?: unknown };
        if (!Array.isArray(body.themes)) {
          return;
        }
        const themes = body.themes.filter(
          (entry): entry is MermaidThemeEntry =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as { name?: unknown }).name === "string"
        );
        state.mermaidThemes = themes;
        state.data.mermaidThemes = themes;
        sanitizeSnapshotsMermaid(themes);
        toast(`Tema Mermaid removido: ${name}`);
        updateDirty();
      } catch {
        /* keep the current UI on failure */
      }
    })();
  }

  /**
   * Moves the draft to a pack that still exists after a catalog change. The
   * applied snapshot is left alone on purpose: removing the active pack is a
   * change like any other and must go through Save (cookie + reload).
   */
  function ensureEmojiSelection(): void {
    const names = new Set(state.data.emojis.map((entry) => entry.name));
    const fallback =
      state.data.emojis.find((entry) => entry.name === "github")?.name ??
      state.data.emojis[0]?.name;
    if (!fallback) {
      return;
    }
    if (!names.has(draft.emojiName)) {
      draft = setDraftEmoji(draft, fallback);
    }
  }

  async function refreshEmojiCatalog(): Promise<boolean> {
    try {
      const response = await fetch("/__emojis", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        return false;
      }
      const body = (await response.json()) as { emojis?: unknown };
      if (!Array.isArray(body.emojis)) {
        return false;
      }
      state.data.emojis = parseEmojiEntries(body.emojis);
      ensureEmojiSelection();
      return true;
    } catch {
      return false;
    }
  }

  /** Import only adds to the catalog; the page already updated its list. */
  function importedEmoji(result: EmojiImportResult): void {
    state.data.emojis =
      result.emojis.length > 0
        ? result.emojis
        : [
            ...state.data.emojis.filter((entry) => entry.name !== result.emoji.name),
            result.emoji,
          ];
    ensureEmojiSelection();
  }

  function deletedEmoji(name: string): void {
    const wasApplied = applied.emojiName === name;
    state.data.emojis = state.data.emojis.filter((entry) => entry.name !== name);
    if (wasApplied) {
      // The deletion is immediate; do not let a stale cookie reactivate the
      // slug if the same pack is imported again later.
      clearEmoji();
      const url = new URL(location.href);
      if (url.searchParams.get("emoji") === name) {
        url.searchParams.delete("emoji");
        history.replaceState(
          history.state,
          "",
          `${url.pathname}${url.search}${location.hash}`
        );
      }
    }
    ensureEmojiSelection();
    updateDirty();
    void (async () => {
      if (!(await refreshEmojiCatalog())) {
        return;
      }
      if (!modal.isOpen()) {
        return;
      }
      if (emojisPage) {
        emojisPage.update(state.data.emojis, draft.emojiName);
      }
      updateDirty();
    })();
  }

  modal = createSettingsModal({
    root,
    trigger,
    onOpen: (route) => {
      draft = cloneSnapshot(applied);
      render(route);
    },
    onNavigate: (route) => render(route),
    onClose: () => {
      if (committing) {
        return;
      }
      draft = discardSnapshot(applied);
      // Roll the live Widgets previews back to the applied state.
      syncWidgetPreviewClasses(draft);
      clearDirtyRender();
    },
    onSave: save,
    canClose: () => !saving,
  });

  let syncTimer = 0;
  let syncing = false;

  /** A re-render would wipe JSON the user pasted into an import form. */
  function importFormHasContent(): boolean {
    for (const field of document.querySelectorAll<HTMLTextAreaElement>(
      ".mdprv-settings-import-form textarea"
    )) {
      if (field.value.trim() !== "") {
        return true;
      }
    }
    return false;
  }

  function canRerender(): boolean {
    // Any import form (themes or emojis) keeps whatever the user typed.
    return !importFormHasContent();
  }

  async function syncCatalogs(): Promise<void> {
    if (syncing) {
      return;
    }
    syncing = true;
    try {
      const [themeRes, shikiRes, mermaidRes, emojiRes] = await Promise.all([
        fetch("/__themes", { headers: { accept: "application/json" }, cache: "no-store" }),
        fetch("/__shiki-themes", { headers: { accept: "application/json" }, cache: "no-store" }),
        fetch("/__mermaid-themes", { headers: { accept: "application/json" }, cache: "no-store" }),
        fetch("/__emojis", { headers: { accept: "application/json" }, cache: "no-store" }),
      ]);
      if (themeRes.ok) {
        const body = (await themeRes.json()) as { catalog?: unknown };
        if (Array.isArray(body.catalog)) {
          const parsed = parsePageThemeData({ ...state.data, catalog: body.catalog });
          if (parsed) {
            state.data.catalog = parsed.catalog;
          }
        }
      }
      if (shikiRes.ok) {
        const body = (await shikiRes.json()) as { themes?: unknown };
        if (Array.isArray(body.themes)) {
          state.shikiThemes = body.themes.filter(
            (entry): entry is ShikiThemeEntry =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { name?: unknown }).name === "string" &&
              typeof (entry as { label?: unknown }).label === "string"
          );
          state.data.shikiThemes = state.shikiThemes;
          clearCodePreviewCache();
        }
      }
      if (mermaidRes.ok) {
        const body = (await mermaidRes.json()) as { themes?: unknown };
        if (Array.isArray(body.themes)) {
          state.mermaidThemes = body.themes.filter(
            (entry): entry is MermaidThemeEntry =>
              typeof entry === "object" &&
              entry !== null &&
              typeof (entry as { name?: unknown }).name === "string" &&
              typeof (entry as { label?: unknown }).label === "string"
          );
          state.data.mermaidThemes = state.mermaidThemes;
        }
      }
      if (emojiRes.ok) {
        const body = (await emojiRes.json()) as { emojis?: unknown };
        if (Array.isArray(body.emojis)) {
          state.data.emojis = parseEmojiEntries(body.emojis);
          ensureEmojiSelection();
        }
      }
      if (modal.isOpen()) {
        // The Emojis page updates in place; re-rendering it would reset the
        // preview and any JSON typed in the import form.
        if (modal.currentRoute().section === "emojis" && emojisPage) {
          emojisPage.update(state.data.emojis, draft.emojiName);
          updateDirty();
        } else if (canRerender()) {
          renderPreservingView(modal.currentRoute());
        }
      }
    } catch {
      /* keep the current catalog on failure */
    } finally {
      syncing = false;
    }
  }

  function scheduleCatalogSync(): void {
    window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      void syncCatalogs();
    }, 180);
  }

  on("themes", scheduleCatalogSync);
  on("shiki-themes", scheduleCatalogSync);
  on("mermaid-themes", scheduleCatalogSync);
  on("emojis", scheduleCatalogSync);

  document.addEventListener("keydown", (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== ",") {
      return;
    }
    event.preventDefault();
    if (modal.isOpen()) {
      modal.close();
    } else {
      modal.open(lastRoute());
    }
  });

  // Mantém os presets coerentes com o sistema enquanto `auto` está ativo.
  try {
    if (typeof window.matchMedia === "function") {
      const query = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = (): void => {
        const nextScheme = schemeForKind("auto");
        const draftEntry = findCatalogEntry(state.data, draft.themeName);
        const appliedEntry = findCatalogEntry(state.data, applied.themeName);
        if (draftEntry?.kind === "auto") {
          draft = setDraftTheme(draft, draft.themeName, nextScheme);
        }
        if (appliedEntry?.kind === "auto") {
          applied = setDraftTheme(applied, applied.themeName, nextScheme);
        }
        if (modal.isOpen() && canRerender()) {
          renderPreservingView(modal.currentRoute());
        }
      };
      if (typeof query.addEventListener === "function") {
        query.addEventListener("change", onChange);
      } else if (typeof query.addListener === "function") {
        query.addListener(onChange);
      }
    }
  } catch {
    /* matchMedia unavailable */
  }

  const pending = sessionGet(OPEN_KEY);
  if (pending !== null) {
    sessionRemove(OPEN_KEY);
    const route = parseSettingsRouteString(pending) ?? lastRoute();
    modal.open(route);
  }
}
