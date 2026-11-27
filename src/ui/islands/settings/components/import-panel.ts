/**
 * Formulário de importação reutilizado pelos três tipos de tema da página
 * Importar. Cada fornecedor (cores, Shiki, Mermaid) injeta apenas as regras
 * puras de payload/erro e os callbacks de estado; o DOM e o fluxo de rede são
 * idênticos para os três blocos.
 */
import { el, icon, uid } from "../components";

export const IMPORT_MAX_BYTES = 256 * 1024;

export interface ImportPanelItem {
  name: string;
  label: string;
  /** Compact origin/kind hint shown under the name. */
  meta?: string;
}

export interface ImportPanelResponse<T> {
  theme: T;
  themes: T[];
}

export interface ImportPanelConfig<T> {
  /** Prefix used to generate unique DOM ids. */
  slug: string;
  help: string;
  namePlaceholder: string;
  nameMaxLength: number;
  textareaPlaceholder: string;
  textareaLabel?: string;
  textareaRows?: number;
  accept?: string;
  endpoint: string;
  deleteEndpoint: (name: string) => string;
  listTitle: string;
  /** Set to false when the page owns the installed list/removal UI. */
  showList?: boolean;
  items: ImportPanelItem[];
  /** Maps a server theme to its installed-list row. */
  toItem: (theme: T) => ImportPanelItem;
  /** Maps a full catalog to the installed-list rows (drops builtins). */
  itemsFrom: (themes: T[]) => ImportPanelItem[];
  buildPayload: (
    text: string,
    name: string
  ) => { ok: true; value: unknown } | { ok: false; error: string };
  deriveName: (parsed: unknown) => string;
  slugFromFile: (filename: string) => string;
  errorMessage: (status: number, body: string) => string;
  /**
   * Maps the server body to the imported item + full catalog. Defaults to the
   * theme endpoints (`{ theme, themes }`); emoji packs return `{ emoji, emojis }`.
   */
  readResponse?: (body: unknown) => ImportPanelResponse<T> | null;
  onImported: (result: ImportPanelResponse<T>) => void;
  onDeleted: (name: string) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function renderImportPanel<T>(config: ImportPanelConfig<T>): HTMLElement {
  const base = uid(`mdprv-settings-import-${config.slug}`);
  const nameId = `${base}-name`;
  const fileId = `${base}-file`;
  const textId = `${base}-text`;
  const helpId = `${base}-help`;

  const nameInput = el("input", {
    id: nameId,
    class: "mdprv-settings-field-input",
    type: "text",
    maxlength: String(config.nameMaxLength),
    pattern: "[a-z0-9][a-z0-9-]*",
    placeholder: config.namePlaceholder,
    autocomplete: "off",
    spellcheck: "false",
    "aria-describedby": helpId,
  });
  const fileInput = el("input", {
    id: fileId,
    class: "mdprv-settings-file-input",
    type: "file",
    accept: config.accept ?? ".json,application/json",
  });
  const textarea = el("textarea", {
    id: textId,
    class: "mdprv-settings-field-textarea",
    rows: String(config.textareaRows ?? 8),
    spellcheck: "false",
    placeholder: config.textareaPlaceholder,
  });
  const error = el("p", {
    class: "mdprv-settings-field-error",
    role: "alert",
    hidden: true,
  });
  const status = el("p", {
    class: "mdprv-settings-import-status",
    role: "status",
    "aria-live": "polite",
  });
  const messages = el(
    "div",
    { class: "mdprv-settings-import-message" },
    error,
    status
  );
  const importBtn = el(
    "button",
    { type: "button", class: "mdprv-settings-btn" },
    icon("check", 15),
    el("span", {}, "Importar")
  );

  const list = el("div", { class: "mdprv-settings-custom-list" });
  let items = [...config.items];

  function showError(message: string): void {
    error.textContent = message;
    error.hidden = false;
  }

  function clearError(): void {
    error.textContent = "";
    error.hidden = true;
  }

  function parsedJson(): unknown {
    try {
      return JSON.parse(textarea.value);
    } catch {
      return null;
    }
  }

  function deriveName(): void {
    if (nameInput.value.trim() !== "") {
      return;
    }
    const parsed = parsedJson();
    if (parsed === null) {
      return;
    }
    const name = config.deriveName(parsed);
    if (name !== "") {
      nameInput.value = name;
    }
  }

  function renderItems(items: ImportPanelItem[]): void {
    list.replaceChildren();
    if (config.showList === false || items.length === 0) {
      return;
    }
    list.appendChild(el("p", { class: "mdprv-settings-field-label" }, config.listTitle));
    for (const entry of items) {
      const remove = el(
        "button",
        {
          type: "button",
          class: "mdprv-settings-btn mdprv-settings-btn--compact",
          "aria-label": `Remover ${entry.label}`,
        },
        el("span", {}, "Remover")
      );
      remove.addEventListener("click", () => {
        void (async () => {
          clearError();
          remove.disabled = true;
          try {
            const response = await fetch(config.deleteEndpoint(entry.name), {
              method: "DELETE",
              headers: { accept: "application/json" },
            });
            if (!response.ok) {
              showError(config.errorMessage(response.status, await response.text()));
              return;
            }
            // Update the installed list in place: a page re-render would wipe
            // whatever JSON the other forms still hold.
            items = items.filter((item) => item.name !== entry.name);
            renderItems(items);
            config.onDeleted(entry.name);
          } catch (err) {
            showError(err instanceof Error ? err.message : String(err));
          } finally {
            remove.disabled = false;
          }
        })();
      });

      list.appendChild(
        el(
          "div",
          { class: "mdprv-settings-custom-row" },
          el(
            "span",
            { class: "mdprv-settings-custom-copy" },
            el("span", { class: "mdprv-settings-custom-name" }, entry.label),
            entry.meta
              ? el("span", { class: "mdprv-settings-custom-meta" }, entry.meta)
              : null
          ),
          remove
        )
      );
    }
  }

  importBtn.addEventListener("click", () => {
    void (async () => {
      clearError();
      const payload = config.buildPayload(textarea.value, nameInput.value);
      if (!payload.ok) {
        showError(payload.error);
        return;
      }
      importBtn.disabled = true;
      status.textContent = "Importando…";
      try {
        const response = await fetch(config.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(payload.value),
        });
        if (!response.ok) {
          showError(config.errorMessage(response.status, await response.text()));
          return;
        }
        const raw = (await response.json()) as {
          theme?: T;
          themes?: T[];
        };
        const parsed = config.readResponse
          ? config.readResponse(raw)
          : raw.theme
            ? { theme: raw.theme, themes: raw.themes ?? [] }
            : null;
        if (!parsed?.theme) {
          showError("O servidor não devolveu o item importado.");
          return;
        }
        const themes = parsed.themes;
        const imported = config.toItem(parsed.theme);
        items = themes.length > 0
          ? config.itemsFrom(themes)
          : [
              ...items.filter((item) => item.name !== imported.name),
              imported,
            ];
        renderItems(items);
        config.onImported({ theme: parsed.theme, themes });
      } catch (err) {
        showError(err instanceof Error ? err.message : String(err));
      } finally {
        importBtn.disabled = false;
        status.textContent = "";
      }
    })();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    clearError();
    if (file.size > IMPORT_MAX_BYTES) {
      showError("Arquivo grande demais (máximo 256 KiB).");
      fileInput.value = "";
      return;
    }
    void file.text().then((text) => {
      textarea.value = text;
      if (nameInput.value.trim() === "") {
        nameInput.value = config.slugFromFile(file.name);
      }
      deriveName();
    });
  });

  textarea.addEventListener("paste", () => {
    setTimeout(deriveName, 0);
  });
  textarea.addEventListener("blur", deriveName);

  renderItems(items);

  return el(
    "div",
    { class: "mdprv-settings-import-form" },
    el("p", { class: "mdprv-settings-note", id: helpId }, config.help),
    el(
      "div",
      { class: "mdprv-settings-field" },
      el("label", { class: "mdprv-settings-field-label", for: nameId }, "Nome"),
      nameInput
    ),
    el(
      "div",
      { class: "mdprv-settings-field" },
      el("label", { class: "mdprv-settings-field-label", for: fileId }, "Arquivo JSON"),
      fileInput
    ),
    el(
      "div",
      { class: "mdprv-settings-field" },
      el(
        "label",
        { class: "mdprv-settings-field-label", for: textId },
        config.textareaLabel ?? "JSON do tema"
      ),
      textarea
    ),
    messages,
    el("div", { class: "mdprv-settings-import-actions" }, importBtn),
    list
  );
}
