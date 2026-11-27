/**
 * Página Ícones: catálogo de pacotes, seleção do pacote ativo, prévia ao vivo
 * e importação.
 *
 * A seleção vai para o rascunho (`ctx.selectIcon`) e só grava o cookie
 * `mdprv_icons` no Save. Importar só adiciona ao catálogo; aplicar é uma ação
 * separada. Lista e prévia são atualizadas in-place para não apagar o JSON já
 * digitado no formulário nem deslocar o layout do modal.
 */
import type { IconPackEntry } from "../../../../core/contract";
import { button, contentBlock, el, icon, sectionHeader, toast } from "../components";
import {
  renderImportPanel,
  type ImportPanelResponse,
} from "../components/import-panel";
import {
  buildIconImportPayload,
  deriveIconName,
  iconImportError,
  iconSlugFromFile,
  type IconImportResult,
} from "../previews/icon-import";
import {
  iconPackCredit,
  iconPackMeta,
  iconPreviewKeys,
  iconPreviewSrc,
  isDefaultIconPack,
  isUserIconPack,
} from "../previews/icon-preview";

export interface IconsContext {
  icons: IconPackEntry[];
  iconName: string;
  /** Moves the selection into the draft (no cookie until Save). */
  selectIcon(name: string): void;
  importedIcon(result: IconImportResult): void;
  deletedIcon(name: string): void;
}

export interface IconsPageHandle {
  root: HTMLElement;
  /** SSE/catalog sync: updates the list and preview without re-rendering. */
  update(icons: IconPackEntry[], iconName: string): void;
}

function packItem(entry: IconPackEntry): { name: string; label: string; meta: string } {
  return { name: entry.name, label: entry.label, meta: iconPackMeta(entry) };
}

function defaultName(icons: IconPackEntry[]): string {
  return (
    icons.find((entry) => isDefaultIconPack(entry))?.name ??
    icons.find((entry) => entry.name === "breeze")?.name ??
    icons[0]?.name ??
    ""
  );
}

export function renderIconsPage(ctx: IconsContext): IconsPageHandle {
  let icons = [...ctx.icons];
  let selected = ctx.iconName;

  const list = el("div", {
    class: "mdprv-settings-icon-packs",
    role: "radiogroup",
    "aria-label": "Pacote de ícones",
  });
  const preview = el("div", {
    class: "mdprv-settings-icon-preview",
    "aria-live": "polite",
  });

  function current(): IconPackEntry | undefined {
    return icons.find((entry) => entry.name === selected);
  }

  function syncRadios(): void {
    for (const node of list.querySelectorAll<HTMLButtonElement>(
      ".mdprv-settings-icon-pack-select"
    )) {
      const active = node.dataset.icon === selected;
      node
        .closest(".mdprv-settings-icon-pack")
        ?.classList.toggle("is-selected", active);
      node.setAttribute("aria-checked", String(active));
    }
  }

  function renderPreview(): void {
    const entry = current();
    if (!entry) {
      preview.replaceChildren(
        el(
          "p",
          { class: "mdprv-settings-icon-caption" },
          "Selecione um pacote para ver os ícones."
        )
      );
      return;
    }
    const keys = iconPreviewKeys();
    const grid = el(
      "div",
      { class: "mdprv-settings-icon-grid" },
      keys.map((key) =>
        el(
          "span",
          {
            class: "mdprv-settings-icon-sample",
            title: key,
          },
          el("span", {
            class: "mdprv-icon",
            dataset: { icon: key },
            style: { "--mdprv-icon-src": `url("${iconPreviewSrc(entry, key)}")` },
          }),
          el("span", { class: "mdprv-settings-icon-sample-name" }, key)
        )
      )
    );
    preview.replaceChildren(
      grid,
      el(
        "p",
        { class: "mdprv-settings-icon-caption" },
        `${keys.length} ícones · ${entry.label}`
      )
    );
  }

  function select(name: string): void {
    if (name === selected || !icons.some((entry) => entry.name === name)) {
      return;
    }
    selected = name;
    syncRadios();
    ctx.selectIcon(name);
    // The grid is local (no fetch), so the selected pack shows immediately
    // even before Save applies the cookie.
    renderPreview();
  }

  function removePack(entry: IconPackEntry): void {
    if (!isUserIconPack(entry)) {
      return;
    }
    const ok = window.confirm(
      `Remover o pacote de ícones "${entry.label}"? Esta ação apaga o arquivo do disco.`
    );
    if (!ok) {
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`/__icons/${encodeURIComponent(entry.name)}`, {
          method: "DELETE",
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          toast(iconImportError(response.status, await response.text()));
          return;
        }
        icons = icons.filter((item) => item.name !== entry.name);
        if (selected === entry.name) {
          selected = defaultName(icons);
          if (selected !== "") {
            ctx.selectIcon(selected);
          }
        }
        renderList();
        renderPreview();
        ctx.deletedIcon(entry.name);
        toast(`Pacote de ícones removido: ${entry.label}`);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err));
      }
    })();
  }

  function packRow(entry: IconPackEntry): HTMLElement {
    const active = entry.name === selected;
    const selectButton = el(
      "button",
      {
        type: "button",
        class: "mdprv-settings-icon-pack-select",
        role: "radio",
        "aria-checked": String(active),
        dataset: { icon: entry.name },
        onclick: () => select(entry.name),
      },
      el(
        "span",
        { class: "mdprv-settings-icon-pack-check", "aria-hidden": "true" },
        icon("check", 13)
      ),
      el(
        "span",
        { class: "mdprv-settings-icon-pack-copy" },
        el(
          "span",
          { class: "mdprv-settings-icon-pack-head" },
          el("span", { class: "mdprv-settings-icon-pack-name" }, entry.label),
          isDefaultIconPack(entry)
            ? el("span", { class: "mdprv-settings-icon-pack-badge" }, "padrão")
            : null
        ),
        el("span", { class: "mdprv-settings-icon-pack-meta" }, iconPackMeta(entry)),
        el(
          "span",
          { class: "mdprv-settings-icon-pack-credit" },
          iconPackCredit(entry) ?? ""
        )
      )
    );

    const card = el(
      "div",
      {
        class: ["mdprv-settings-icon-pack", active ? "is-selected" : ""],
      },
      selectButton
    );
    if (isUserIconPack(entry)) {
      // Icon-only action kept inside the card so the list stays a single
      // column; the title/aria-label carry the pack name for screen readers.
      card.classList.add("has-remove");
      card.appendChild(
        el(
          "button",
          {
            type: "button",
            class: "mdprv-settings-icon-pack-remove",
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
    const rows = icons.map(packRow);
    list.replaceChildren(...rows);
    if (rows.length === 0) {
      list.appendChild(
        el("p", { class: "mdprv-settings-note" }, "Nenhum pacote instalado.")
      );
    }
  }

  list.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }
    const radios = [
      ...list.querySelectorAll<HTMLButtonElement>(".mdprv-settings-icon-pack-select"),
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

  const panel = renderImportPanel<IconPackEntry>({
    slug: "icon",
    help:
      "Aceita um icon.json com schemaVersion 1. O arquivo é gravado como <slug>.json em <configDir>/icons/ (até 256 KiB).",
    namePlaceholder: "meu-pacote",
    nameMaxLength: 64,
    textareaRows: 10,
    textareaLabel: "JSON do pacote",
    textareaPlaceholder:
      '{\n  "schemaVersion": 1,\n  "name": "meu-pacote",\n  "style": "symbolic",\n  "icons": { "copy": "meu-pacote/copy.svg" }\n}',
    endpoint: "/__icons",
    deleteEndpoint: (name) => `/__icons/${encodeURIComponent(name)}`,
    listTitle: "Pacotes importados",
    // The catalog list above owns removal (with confirmation); the panel is
    // only the import form, so its own list stays hidden.
    showList: false,
    items: [],
    toItem: packItem,
    itemsFrom: (entries) => entries.filter(isUserIconPack).map(packItem),
    buildPayload: buildIconImportPayload,
    deriveName: deriveIconName,
    slugFromFile: iconSlugFromFile,
    errorMessage: iconImportError,
    readResponse: (body): ImportPanelResponse<IconPackEntry> | null => {
      const raw = body as { icon?: IconPackEntry; icons?: IconPackEntry[] };
      return raw.icon
        ? { theme: raw.icon, themes: Array.isArray(raw.icons) ? raw.icons : [] }
        : null;
    },
    onImported: (result) => {
      icons =
        result.themes.length > 0
          ? result.themes
          : [
              ...icons.filter((item) => item.name !== result.theme.name),
              result.theme,
            ];
      ctx.importedIcon({ icon: result.theme, icons });
      renderList();
      renderPreview();
      // Keep the selection and the JSON in the textarea untouched.
      toast(`Pacote de ícones importado: ${result.theme.label}`);
    },
    onDeleted: () => {
      /* removal lives in the catalog list above */
    },
  });

  const root = el(
    "div",
    { class: "mdprv-settings-page" },
    sectionHeader({
      title: "Ícones",
      description:
        "Pacotes de ícones usados na interface do preview e no próprio painel.",
    }),
    contentBlock({
      title: "Pacote ativo",
      description:
        "Os ícones desenhados pela aplicação usam o pacote escolhido. A troca é aplicada ao salvar (cookie mdprv_icons) e recarrega a página uma vez.",
      children: [list],
    }),
    contentBlock({
      title: "Prévia",
      description:
        "Todos os nomes de ícone conhecidos, já com o pacote selecionado e herdando a cor do tema.",
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
  renderPreview();

  return {
    root,
    update(next, iconName) {
      const focused = document.activeElement as HTMLElement | null;
      const focusIcon =
        focused?.classList.contains("mdprv-settings-icon-pack-select") === true
          ? focused.dataset.icon ?? ""
          : "";
      icons = [...next];
      selected = iconName;
      renderList();
      if (focusIcon !== "") {
        list
          .querySelector<HTMLButtonElement>(
            `.mdprv-settings-icon-pack-select[data-icon="${CSS.escape(focusIcon)}"]`
          )
          ?.focus();
      }
      renderPreview();
    },
  };
}
