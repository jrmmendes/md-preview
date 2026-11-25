/**
 * Cards de prévia do bloco Código.
 *
 * Cada card pede `/__preview/code` (Shiki roda no servidor) e injeta o HTML
 * real de `pre.shiki`, usando `background`/`foreground` retornados pela API
 * para colorir o cartão. Nenhum token é replicado no cliente.
 *
 * O card declara seu próprio esquema (`data-preview-scheme`) para que as
 * regras globais de `.shiki` baseadas em `html[data-scheme]` não pintem um card
 * claro com as cores do modo escuro (ou vice-versa).
 */
import type { ShikiThemeEntry } from "../../../../core/contract";
import { el, iconMenu } from "../components";

interface PreviewPayload {
  html?: unknown;
  background?: unknown;
  foreground?: unknown;
}

async function fetchPreview(
  theme: string
): Promise<{ html: string; background: string; foreground: string } | null> {
  try {
    const response = await fetch(
      `/__preview/code?theme=${encodeURIComponent(theme)}&lang=ts`,
      { headers: { accept: "application/json" }, cache: "no-store" }
    );
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as PreviewPayload;
    if (typeof body.html !== "string") {
      return null;
    }
    return {
      html: body.html,
      background: typeof body.background === "string" ? body.background : "",
      foreground: typeof body.foreground === "string" ? body.foreground : "",
    };
  } catch {
    return null;
  }
}

export interface CodePreviewConfig {
  light: string;
  dark: string;
  themes: ShikiThemeEntry[];
  editable: boolean;
  onChange: (face: "light" | "dark", theme: string) => void;
}

function optionLabel(entry: ShikiThemeEntry): string {
  return entry.source === "custom" ? `${entry.label} (importado)` : entry.label;
}

function faceOptions(
  themes: ShikiThemeEntry[],
  face: "light" | "dark",
  current: string
): ShikiThemeEntry[] {
  const ordered = themes
    .filter((theme) => theme.kind === face)
    .sort((a, b) => {
      if (a.source !== b.source) {
        return a.source === "builtin" ? -1 : 1;
      }
      return a.label.localeCompare(b.label);
    });
  if (!ordered.some((theme) => theme.name === current)) {
    ordered.unshift({
      name: current,
      label: current,
      kind: face,
      source: "custom",
    });
  }
  return ordered;
}

export function renderCodePreviews(config: CodePreviewConfig): HTMLElement {
  const wrapper = el("div", { class: "mdprv-settings-code" });
  const grid = el("div", { class: "mdprv-settings-code-grid" });

  for (const face of ["light", "dark"] as const) {
    const mode = face === "light" ? "Claro" : "Escuro";
    const incoming = face === "light" ? config.light : config.dark;
    const initial = incoming || (face === "light" ? "github-light" : "github-dark");
    const options = faceOptions(config.themes, face, initial);

    const host = el("div", { class: "mdprv-settings-code-host" });
    const status = el(
      "p",
      { class: "mdprv-settings-code-status", role: "status", "aria-live": "polite" },
      "Carregando prévia…"
    );
    const card = el(
      "div",
      {
        class: "mdprv-settings-code-card",
        dataset: { face, previewScheme: face },
      },
      host,
      status
    );

    let request = 0;

    async function paint(theme: string): Promise<void> {
      request += 1;
      const current = request;
      card.dataset.shikiTheme = theme;
      status.hidden = false;
      status.textContent = "Carregando prévia…";
      const preview = await fetchPreview(theme);
      if (current !== request) {
        return;
      }
      if (!preview || preview.html === "") {
        host.textContent = "";
        status.textContent = "Prévia indisponível.";
        return;
      }
      host.innerHTML = preview.html;
      status.hidden = true;
      if (preview.background) {
        card.style.setProperty("--settings-code-bg", preview.background);
      }
      if (preview.foreground) {
        card.style.setProperty("--settings-code-fg", preview.foreground);
      }
    }

    const menu = iconMenu({
      label: `Tema Shiki do card ${mode.toLowerCase()}`,
      options: options.map((entry) => ({
        value: entry.name,
        label: optionLabel(entry),
      })),
      value: initial,
      disabled: !config.editable,
      onChange: (value) => {
        config.onChange(face, value);
        void paint(value);
      },
    });

    const bar = el(
      "div",
      { class: "mdprv-settings-preview-bar" },
      el("span", { class: "mdprv-settings-preview-mode" }, mode),
      menu
    );

    grid.appendChild(el("div", { class: "mdprv-settings-preview-column" }, bar, card));
    void paint(initial);
  }

  wrapper.append(grid);
  return wrapper;
}
