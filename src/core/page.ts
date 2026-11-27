import type { ThemePrefs } from "../shared/theme-prefs";
import type {
  EmojiPackEntry,
  PageConfigPayload,
  PageEmojiPayload,
  PageInput,
  PageThemePayload,
  ThemeCatalogEntry,
} from "./contract";
import { emojiPackEntries, getEmojiStore } from "./emoji/index";
import { renderMeta } from "./meta";
import { themeCss } from "./themes/css";
import { themeCatalog } from "./themes/catalog";
import { getThemeStore, type ThemeStore } from "./themes/index";
import { mermaidPayload } from "./themes/mermaid";
import { mermaidThemeEntries, sanitizeMermaidName } from "./themes/mermaid-index";
import { applyThemeOverrides } from "./themes/overrides";
import { sanitizeShikiName, shikiThemeEntries } from "./themes/shiki-index";

const warnedThemeRefs = new Set<string>();

function warnOnce(message: string): void {
  if (warnedThemeRefs.has(message)) {
    return;
  }
  warnedThemeRefs.add(message);
  try {
    process.stderr.write(`md-preview: ${message}\n`);
  } catch {
    /* no stderr */
  }
}

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export interface RenderPageOptions {
  /** Per-browser Shiki/Mermaid overrides applied before CSS and payloads. */
  prefs?: ThemePrefs | null;
  /** Read-only daemon settings for the settings modal. */
  config?: PageConfigPayload | null;
  /** Effective emoji pack slug resolved for this request. */
  emojiName?: string | null;
}

export function renderPage(
  input: PageInput,
  shell: string,
  store?: ThemeStore,
  options: RenderPageOptions = {}
): string {
  const themes = store ?? getThemeStore();
  const theme = applyThemeOverrides(themes.get(input.themeName), options.prefs ?? null);
  const mermaid = mermaidPayload(theme);

  // An explicit loader (env or config.json) beats the theme preset; otherwise
  // the theme decides per scheme, so `auto` can use a different loader in dark.
  const explicitLoader = (input.loaderFrom ?? "default") !== "default";
  const loader = explicitLoader ? input.loader : theme.light.loader;
  const loaderDark = explicitLoader ? input.loader : theme.dark.loader;

  // Server-side initial scheme; the boot script refines it for `auto`.
  const scheme = theme.kind === "auto" ? "light" : theme.kind;

  const themePayload: PageThemePayload = {
    name: theme.name,
    kind: theme.kind,
    scheme,
    loaders: { light: theme.light.loader, dark: theme.dark.loader },
    font: { family: theme.light.typography.family, stack: theme.light.typography.stack },
    shiki: {
      light: sanitizeShikiName(theme.light.shiki.light, "light", warnOnce),
      dark: sanitizeShikiName(theme.dark.shiki.dark, "dark", warnOnce),
    },
    mermaidTheme: {
      light: sanitizeMermaidName(theme.light.mermaid.theme),
      dark: sanitizeMermaidName(theme.dark.mermaid.theme),
    },
  };

  const catalog: ThemeCatalogEntry[] = themeCatalog(themes);
  const shikiThemes = shikiThemeEntries();
  const mermaidThemes = mermaidThemeEntries();
  const emojiPack = getEmojiStore().get(options.emojiName ?? null);
  const emojis: EmojiPackEntry[] = emojiPackEntries();
  const emoji: PageEmojiPayload = { name: emojiPack.name, style: emojiPack.style };

  const fill: Array<[string, string]> = [
    ["{{mdprv-title}}", Bun.escapeHTML(input.title)],
    ["{{mdprv-theme}}", theme.name],
    ["{{mdprv-loader}}", loader],
    ["{{mdprv-loader-dark}}", loaderDark],
    ["{{mdprv-scheme}}", scheme],
    ["{{mdprv-shiki-light}}", themePayload.shiki.light],
    ["{{mdprv-shiki-dark}}", themePayload.shiki.dark],
    ["{{mdprv-mermaid-light}}", themePayload.mermaidTheme.light],
    ["{{mdprv-mermaid-dark}}", themePayload.mermaidTheme.dark],
    ["{{mdprv-emoji}}", emojiPack.name],
    ["{{mdprv-zoom}}", String(input.zoomSensitivity)],
    ["{{mdprv-theme-css}}", themeCss(theme)],
    ["{{mdprv-meta}}", renderMeta(input.meta)],
    [
      "{{mdprv-data}}",
      jsonForScript({
        mermaid,
        raw: input.raw ?? "",
        theme: themePayload,
        catalog,
        shikiThemes,
        mermaidThemes,
        emojis,
        emoji,
        config: options.config ?? null,
      }),
    ],
  ];

  const out = fill.reduce((html, [token, value]) => html.split(token).join(value), shell);
  return out.split("{{mdprv-body}}").join(input.body);
}
