/**
 * Página Emojis: catálogo de pacotes, seleção do pacote ativo, prévia ao vivo
 * e importação.
 *
 * A seleção vai para o rascunho (`ctx.selectEmoji`) e só grava o cookie
 * `mdprv_emoji` no Save. Importar só adiciona ao catálogo; aplicar é uma ação
 * separada. Lista e prévia são atualizadas in-place para não apagar o JSON já
 * digitado no formulário nem deslocar o layout do modal.
 */
import type { EmojiPackEntry, EmojiSamplesPayload } from "../../../../core/contract";
import { button, contentBlock, el, icon, sectionHeader, toast } from "../components";
import {
  renderImportPanel,
  type ImportPanelResponse,
} from "../components/import-panel";
import {
  buildEmojiImportPayload,
  deriveEmojiName,
  emojiImportError,
  emojiSlugFromFile,
  type EmojiImportResult,
} from "../previews/emoji-import";
import {
  emojiPackCredit,
  emojiPackMeta,
  emojiSampleView,
  isUserEmojiPack,
  loadEmojiSamples,
} from "../previews/emoji-preview";

export interface EmojisContext {
  emojis: EmojiPackEntry[];
  emojiName: string;
  /** Moves the selection into the draft (no cookie until Save). */
  selectEmoji(name: string): void;
  importedEmoji(result: EmojiImportResult): void;
  deletedEmoji(name: string): void;
}

export interface EmojisPageHandle {
  root: HTMLElement;
  /** SSE/catalog sync: updates the list and preview without re-rendering. */
  update(emojis: EmojiPackEntry[], emojiName: string): void;
}

function packItem(entry: EmojiPackEntry): { name: string; label: string; meta: string } {
  return { name: entry.name, label: entry.label, meta: emojiPackMeta(entry) };
}

export function renderEmojisPage(ctx: EmojisContext): EmojisPageHandle {
  let emojis = [...ctx.emojis];
  let selected = ctx.emojiName;
  let request = 0;
  const cache = new Map<string, EmojiSamplesPayload>();

  const list = el("div", {
    class: "mdprv-settings-emoji-packs",
    role: "radiogroup",
    "aria-label": "Pacote de emojis",
  });
  const preview = el("div", {
    class: "mdprv-settings-emoji-preview",
    "aria-live": "polite",
    "aria-busy": "false",
  });

  function current(): EmojiPackEntry | undefined {
    return emojis.find((entry) => entry.name === selected);
  }

  function syncRadios(): void {
    for (const node of list.querySelectorAll<HTMLButtonElement>(
      ".mdprv-settings-emoji-pack-select"
    )) {
      const active = node.dataset.emoji === selected;
      node
        .closest(".mdprv-settings-emoji-pack")
        ?.classList.toggle("is-selected", active);
      node.setAttribute("aria-checked", String(active));
    }
  }

  function select(name: string): void {
    if (name === selected || !emojis.some((entry) => entry.name === name)) {
      return;
    }
    selected = name;
    syncRadios();
    ctx.selectEmoji(name);
    void refreshPreview();
  }

  function removePack(entry: EmojiPackEntry): void {
    if (!isUserEmojiPack(entry)) {
      return;
    }
    const ok = window.confirm(
      `Remover o pacote de emojis "${entry.label}"? Esta ação apaga o arquivo do disco.`
    );
    if (!ok) {
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/__emojis/${encodeURIComponent(entry.name)}`, {
          method: "DELETE",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          toast(emojiImportError(response.status, await response.text()));
          return;
        }
        cache.delete(entry.name);
        emojis = emojis.filter((item) => item.name !== entry.name);
        if (selected === entry.name) {
          selected = emojis.find((item) => item.name === "github")?.name
            ?? emojis[0]?.name
            ?? "";
          if (selected !== "") {
            ctx.selectEmoji(selected);
          }
        }
        renderList();
        ctx.deletedEmoji(entry.name);
        toast(`Pacote de emojis removido: ${entry.label}`);
        void refreshPreview();
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err));
      }
    })();
  }

  function packRow(entry: EmojiPackEntry): HTMLElement {
    const active = entry.name === selected;
    const selectButton = el(
      "button",
      {
        type: "button",
        class: "mdprv-settings-emoji-pack-select",
        role: "radio",
        "aria-checked": String(active),
        dataset: { emoji: entry.name },
        onclick: () => select(entry.name),
      },
      el(
        "span",
        { class: "mdprv-settings-emoji-pack-check", "aria-hidden": "true" },
        icon("check", 13)
      ),
      el(
        "span",
        { class: "mdprv-settings-emoji-pack-copy" },
        el("span", { class: "mdprv-settings-emoji-pack-name" }, entry.label),
        el("span", { class: "mdprv-settings-emoji-pack-meta" }, emojiPackMeta(entry)),
        el(
          "span",
          { class: "mdprv-settings-emoji-pack-credit" },
          emojiPackCredit(entry) ?? ""
        )
      )
    );

    const card = el(
      "div",
      {
        class: ["mdprv-settings-emoji-pack", active ? "is-selected" : ""],
      },
      selectButton
    );
    if (isUserEmojiPack(entry)) {
      // Icon-only action kept inside the card so the list stays a single
      // column; the title/aria-label carry the pack name for screen readers.
      card.classList.add("has-remove");
      card.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "mdprv-settings-emoji-pack-remove",
            title: `Remover ${entry.label}`,
            "aria-label": `Remover ${entry.label}`,
            onclick: () => removePack(entry),
          },
          icon("trash", 16)
        )
      );
    }
    return card;
  }

  function renderList(): void {
    const rows = emojis.map(packRow);
    list.replaceChildren(...rows);
    if (rows.length === 0) {
      list.appendChild(
        el("p", { class: "mdprv-settings-note" }, "Nenhum pacote instalado.")
      );
    }
  }

  function sampleCell(entry: EmojiPackEntry, sample: { name: string; value: string }): HTMLElement {
    const view = emojiSampleView(entry, sample);
    const cell = el("span", {
      class: "mdprv-settings-emoji-sample",
      title: `:${sample.name}:`,
    });
    if (view.kind === "image") {
      const img = el("img", {
        class: "mdprv-emoji",
        src: view.src,
        alt: `:${sample.name}:`,
        loading: "lazy",
      });
      img.addEventListener("error", () => {
        img.remove();
        cell.insertBefore(
          el(
            "span",
            { class: "mdprv-settings-emoji-glyph" },
            view.fallback === "" ? "·" : view.fallback
          ),
          cell.firstChild
        );
      });
      cell.appendChild(img);
    } else {
      cell.appendChild(
        el("span", { class: "mdprv-settings-emoji-glyph" }, view.text)
      );
    }
    cell.appendChild(
      el("span", { class: "mdprv-settings-emoji-sample-name" }, `:${sample.name}:`)
    );
    return cell;
  }

  function renderSamples(entry: EmojiPackEntry, payload: EmojiSamplesPayload): void {
    const grid = el(
      "div",
      { class: "mdprv-settings-emoji-grid" },
      payload.samples.map((sample) => sampleCell(entry, sample))
    );
    preview.replaceChildren(
      grid,
      el(
        "p",
        { class: "mdprv-settings-emoji-caption" },
        payload.samples.length < payload.total
          ? `Mostrando ${payload.samples.length} de ${payload.total} shortcodes.`
          : `${payload.total} shortcodes.`
      )
    );
    preview.setAttribute("aria-busy", "false");
  }

  function renderLoading(): void {
    const grid = el(
      "div",
      { class: "mdprv-settings-emoji-grid is-loading" },
      Array.from({ length: 12 }, () =>
        el("span", { class: "mdprv-settings-emoji-sample is-loading" })
      )
    );
    preview.replaceChildren(
      grid,
      el("p", { class: "mdprv-settings-emoji-caption" }, "Carregando amostras…")
    );
    preview.setAttribute("aria-busy", "true");
  }

  function renderPreviewMessage(message: string, retry = false): void {
    preview.replaceChildren(
      el("p", { class: "mdprv-settings-emoji-caption" }, message)
    );
    if (retry) {
      preview.appendChild(
        el(
          "div",
          { class: "mdprv-settings-btn-row" },
          button({
            label: "Tentar novamente",
            iconName: "reset",
            onClick: () => void refreshPreview(true),
          })
        )
      );
    }
    preview.setAttribute("aria-busy", "false");
  }

  async function refreshPreview(force = false): Promise<void> {
    const entry = current();
    const token = (request += 1);
    if (!entry) {
      renderPreviewMessage("Selecione um pacote para ver as amostras.");
      return;
    }
    const cached = force ? undefined : cache.get(entry.name);
    if (cached) {
      renderSamples(entry, cached);
      return;
    }
    renderLoading();
    const payload = await loadEmojiSamples(entry.name);
    // The user may have selected another pack or navigated away meanwhile.
    if (token !== request || !preview.isConnected) {
      return;
    }
    if (!payload) {
      renderPreviewMessage("Não foi possível carregar as amostras.", true);
      return;
    }
    cache.set(entry.name, payload);
    renderSamples(entry, payload);
  }

  list.addEventListener("keydown", (event) => {
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
    ) {
      return;
    }
    const radios = [
      ...list.querySelectorAll<HTMLButtonElement>(".mdprv-settings-emoji-pack-select"),
    ];
    const index = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowDown") {
      next = (index + 1) % radios.length;
    } else if (event.key === "ArrowUp") {
      next = (index - 1 + radios.length) % radios.length;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = radios.length - 1;
    }
    radios[next]?.focus();
    radios[next]?.click();
  });

  const panel = renderImportPanel<EmojiPackEntry>({
    slug: "emoji",
    help:
      "Aceita um emoji.json com schemaVersion 1. O arquivo é gravado como <slug>.json em <configDir>/emojis/ (até 256 KiB).",
    namePlaceholder: "meu-pacote",
    nameMaxLength: 64,
    textareaRows: 10,
    textareaLabel: "JSON do pacote",
    textareaPlaceholder:
      '{\n  "schemaVersion": 1,\n  "name": "meu-pacote",\n  "style": "native",\n  "shortcodes": { "smile": "😄" }\n}',
    endpoint: "/__emojis",
    deleteEndpoint: (name) => `/__emojis/${encodeURIComponent(name)}`,
    listTitle: "Pacotes importados",
    // The catalog list above owns removal (with confirmation); the panel is
    // only the import form, so its own list stays hidden.
    showList: false,
    items: [],
    toItem: packItem,
    itemsFrom: (entries) => entries.filter(isUserEmojiPack).map(packItem),
    buildPayload: buildEmojiImportPayload,
    deriveName: deriveEmojiName,
    slugFromFile: emojiSlugFromFile,
    errorMessage: emojiImportError,
    readResponse: (body): ImportPanelResponse<EmojiPackEntry> | null => {
      const raw = body as { emoji?: EmojiPackEntry; emojis?: EmojiPackEntry[] };
      return raw.emoji
        ? { theme: raw.emoji, themes: Array.isArray(raw.emojis) ? raw.emojis : [] }
        : null;
    },
    onImported: (result) => {
      emojis =
        result.themes.length > 0
          ? result.themes
          : [
              ...emojis.filter((item) => item.name !== result.theme.name),
              result.theme,
            ];
      ctx.importedEmoji({ emoji: result.theme, emojis });
      renderList();
      // Keep the selection and the JSON in the textarea untouched.
      toast(`Pacote de emojis importado: ${result.theme.label}`);
    },
    onDeleted: () => {
      /* removal lives in the catalog list above */
    },
  });

  const root = el(
    "div",
    { class: "mdprv-settings-page" },
    sectionHeader({
      title: "Emojis",
      description:
        "Pacotes de shortcodes :nome: usados no documento e no painel.",
    }),
    contentBlock({
      title: "Pacote ativo",
      description:
        "O pacote escolhido expande :shortcode: no documento. A troca é aplicada ao salvar (cookie mdprv_emoji).",
      children: [list],
    }),
    contentBlock({
      title: "Prévia",
      description:
        "Amostra do pacote selecionado, com a mesma regra do render: SVG quando existir, senão o glifo Unicode.",
      children: [preview],
    }),
    contentBlock({
      title: "Importar pacote",
      description:
        "Adiciona um pacote ao catálogo. Importar não o aplica: selecione-o acima e salve.",
      children: [panel],
    })
  );

  renderList();
  void refreshPreview();

  return {
    root,
    update(next, emojiName) {
      const focused = document.activeElement as HTMLElement | null;
      const focusEmoji =
        focused?.classList.contains("mdprv-settings-emoji-pack-select") === true
          ? focused.dataset.emoji ?? ""
          : "";
      emojis = [...next];
      selected = emojiName;
      renderList();
      if (focusEmoji !== "") {
        list
          .querySelector<HTMLButtonElement>(
            `[data-emoji="${CSS.escape(focusEmoji)}"]`
          )
          ?.focus();
      }
      void refreshPreview();
    },
  };
}
