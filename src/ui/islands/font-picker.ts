/**
 * Combobox de fontes reutilizável (modal de configurações).
 *
 * Sem IDs globais: cada instância cria os próprios elementos e expõe
 * `setValue`/`setDisabled`. Reutiliza o catálogo do daemon, a busca e o
 * carregamento de Google Fonts já existentes.
 */
import type { FontInfo } from "../../core/contract";
import { searchFonts } from "../services/font-search";
import { GENERIC_FAMILIES, fontStack, sanitizeFamily } from "../services/font-value";
import { fetchFonts, loadGoogleFamily } from "../services/fonts";

const MAX_OPTIONS = 80;

export interface FontOption {
  value: string;
  label: string;
  stack?: string;
}

export interface FontPickerValue {
  family: string;
  stack: string;
  source: "local" | "google";
}

export interface FontPickerConfig {
  value: string;
  stack?: string;
  /** Extra options shown before the system catalog (e.g. the theme preset). */
  options?: FontOption[];
  disabled?: boolean;
  label?: string;
  onChange: (value: FontPickerValue) => void;
}

export interface FontPickerHandle {
  root: HTMLElement;
  setValue(family: string, stack?: string): void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

interface Option extends FontOption {
  kind: "default" | "generic" | "system" | "extra";
}

let uidCounter = 0;

function uid(prefix: string): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

function optionFor(family: string, stack?: string): Option {
  if (family === "") {
    return {
      value: "",
      label: "Padrão do sistema",
      stack,
      kind: "default",
    };
  }
  const generic = (GENERIC_FAMILIES as readonly string[]).includes(family);
  return {
    value: family,
    label: family,
    stack: stack ?? fontStack(family),
    kind: generic ? "generic" : "system",
  };
}

export function createFontPicker(config: FontPickerConfig): FontPickerHandle {
  const listId = uid("mdprv-settings-font-list");
  const root = document.createElement("div");
  root.className = "mdprv-settings-font-picker";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "mdprv-settings-font-trigger";
  trigger.setAttribute("role", "combobox");
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", listId);
  trigger.setAttribute("aria-label", config.label ?? "Fonte");

  const valueNode = document.createElement("span");
  valueNode.className = "mdprv-settings-font-value";
  const chevron = document.createElement("span");
  chevron.className = "mdprv-settings-font-chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML =
    '<span class="mdprv-icon" data-icon="chevron-down" aria-hidden="true"></span>';
  trigger.append(valueNode, chevron);

  const panel = document.createElement("div");
  panel.className = "mdprv-settings-font-panel";
  panel.hidden = true;

  const search = document.createElement("input");
  search.type = "text";
  search.className = "mdprv-settings-font-search";
  search.placeholder = "Buscar fonte";
  search.setAttribute("aria-label", "Buscar fonte");
  search.setAttribute("aria-controls", listId);
  search.setAttribute("autocomplete", "off");
  search.setAttribute("spellcheck", "false");

  const list = document.createElement("div");
  list.className = "mdprv-settings-font-list";
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Fontes disponíveis");

  const footer = document.createElement("div");
  footer.className = "mdprv-settings-font-google";
  const googleInput = document.createElement("input");
  googleInput.type = "text";
  googleInput.className = "mdprv-settings-font-google-input";
  googleInput.placeholder = "Google Fonts (ex.: Inter)";
  googleInput.setAttribute("aria-label", "Família do Google Fonts");
  googleInput.setAttribute("autocomplete", "off");
  googleInput.setAttribute("spellcheck", "false");
  const googleButton = document.createElement("button");
  googleButton.type = "button";
  googleButton.className = "mdprv-settings-btn mdprv-settings-btn--compact";
  googleButton.textContent = "Carregar";
  footer.append(googleInput, googleButton);

  const error = document.createElement("p");
  error.className = "mdprv-settings-font-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  const status = document.createElement("p");
  status.className = "mdprv-settings-font-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = "Fontes do sistema";

  panel.append(search, list, footer, error, status);
  root.append(trigger, panel);

  let selectedFamily = config.value;
  let selectedStack = config.stack ?? "";
  let extras: FontOption[] = [...(config.options ?? [])];
  let systemFonts: FontInfo[] = [];
  let loading = false;
  let loaded = false;
  let open = false;
  let active = -1;
  let visible: Option[] = [];
  let outsideHandler: ((event: Event) => void) | null = null;

  if (config.disabled) {
    root.classList.add("is-disabled");
    trigger.disabled = true;
  }

  function labelFor(family: string): string {
    if (family === "") {
      return "Padrão do sistema";
    }
    const extra = extras.find((option) => option.value === family);
    return extra?.label ?? family;
  }

  function updateTrigger(): void {
    valueNode.textContent = labelFor(selectedFamily);
    const extra = extras.find((option) => option.value === selectedFamily);
    const stack = selectedStack || extra?.stack || fontStack(selectedFamily);
    valueNode.style.fontFamily = stack || "var(--mdprv-font-stack)";
    trigger.setAttribute("aria-label", `${config.label ?? "Fonte"}: ${valueNode.textContent}`);
  }

  function allOptions(): Option[] {
    const seen = new Set<string>();
    const result: Option[] = [];
    const push = (option: Option): void => {
      const key = option.value.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      result.push(option);
    };
    push(optionFor(""));
    for (const generic of GENERIC_FAMILIES) {
      push(optionFor(generic));
    }
    for (const extra of extras) {
      const family = sanitizeFamily(extra.value);
      if (family) {
        push({ ...extra, value: family, label: extra.label || family, kind: "extra" });
      }
    }
    if (selectedFamily !== "") {
      const family = sanitizeFamily(selectedFamily);
      if (family) {
        push(optionFor(family, selectedStack || undefined));
      }
    }
    for (const font of systemFonts) {
      const family = sanitizeFamily(font.family);
      if (family) {
        push(optionFor(family));
      }
    }
    return result;
  }

  function setActive(index: number, scroll: boolean): void {
    active = index;
    const nodes = list.querySelectorAll<HTMLElement>('[role="option"]');
    nodes.forEach((node, position) => {
      node.classList.toggle("is-active", position === index);
    });
    const current = nodes[index];
    if (current) {
      search.setAttribute("aria-activedescendant", current.id);
      if (scroll) {
        current.scrollIntoView({ block: "nearest" });
      }
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  function render(): void {
    const query = search.value.trim();
    const options = allOptions();
    const filtered =
      query === ""
        ? options
        : searchFonts(
            options.map((option) => ({ ...option, family: option.label })),
            query,
            MAX_OPTIONS
          );
    visible = filtered as Option[];

    list.textContent = "";
    const fragment = document.createDocumentFragment();
    filtered.forEach((option, index) => {
      const node = document.createElement("div");
      node.id = `${listId}-${index}`;
      node.className = "mdprv-settings-font-option";
      node.setAttribute("role", "option");
      node.setAttribute("aria-selected", String(option.value === selectedFamily));
      node.dataset.family = option.value;
      node.dataset.index = String(index);
      node.classList.toggle("is-selected", option.value === selectedFamily);

      const copy = document.createElement("span");
      copy.className = "mdprv-settings-font-option-copy";
      copy.style.fontFamily = option.stack ?? "var(--mdprv-font-stack)";
      const name = document.createElement("span");
      name.className = "mdprv-settings-font-option-name";
      name.textContent = option.label;
      const sample = document.createElement("span");
      sample.className = "mdprv-settings-font-option-sample";
      sample.textContent = "Aa Bb Cc 0123";
      copy.append(name, sample);

      const check = document.createElement("span");
      check.className = "mdprv-settings-font-option-check";
      check.setAttribute("aria-hidden", "true");
      check.innerHTML =
        '<span class="mdprv-icon" data-icon="check" aria-hidden="true"></span>';

      node.append(copy, check);
      fragment.appendChild(node);
    });

    if (filtered.length === 0) {
      const empty = document.createElement("p");
      empty.className = "mdprv-settings-font-empty";
      empty.textContent = "Nenhuma fonte encontrada.";
      fragment.appendChild(empty);
    }

    list.appendChild(fragment);
    if (active >= filtered.length) {
      active = filtered.length - 1;
    }
    if (active < 0 && filtered.length > 0) {
      active = 0;
    }
    setActive(active, false);
    status.textContent = loading
      ? "Carregando fontes do sistema…"
      : loaded
        ? `${systemFonts.length} fontes do sistema`
        : "Fontes do sistema";
  }

  function position(): void {
    const rect = trigger.getBoundingClientRect();
    const height = panel.offsetHeight || 300;
    const below = window.innerHeight - rect.bottom;
    root.classList.toggle("is-up", below < height + 16 && rect.top > below);
  }

  async function load(): Promise<void> {
    if (loading || loaded) {
      return;
    }
    loading = true;
    render();
    try {
      const payload = await fetchFonts(false);
      systemFonts = payload.fonts;
      loaded = true;
    } finally {
      loading = false;
      render();
      position();
    }
  }

  function openPanel(): void {
    if (open || config.disabled) {
      return;
    }
    open = true;
    panel.hidden = false;
    root.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    search.value = "";
    active = -1;
    render();
    position();
    search.focus();
    void load();
    outsideHandler = (event) => {
      if (!root.contains(event.target as Node)) {
        closePanel(false);
      }
    };
    document.addEventListener("pointerdown", outsideHandler, true);
  }

  function closePanel(refocus: boolean): void {
    if (!open) {
      if (refocus) {
        trigger.focus();
      }
      return;
    }
    open = false;
    panel.hidden = true;
    root.classList.remove("is-open", "is-up");
    trigger.setAttribute("aria-expanded", "false");
    search.removeAttribute("aria-activedescendant");
    active = -1;
    if (outsideHandler) {
      document.removeEventListener("pointerdown", outsideHandler, true);
      outsideHandler = null;
    }
    if (refocus) {
      trigger.focus();
    }
  }

  function selectOption(option: Option): void {
    selectedFamily = option.value;
    selectedStack = option.stack ?? "";
    updateTrigger();
    closePanel(true);
    config.onChange({
      family: option.value,
      stack: option.stack ?? "",
      source: "local",
    });
  }

  trigger.addEventListener("click", () => {
    if (open) {
      closePanel(false);
    } else {
      openPanel();
    }
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openPanel();
    }
  });

  search.addEventListener("input", () => {
    active = 0;
    render();
  });

  search.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (visible.length > 0) {
        setActive((active + 1) % visible.length, true);
      }
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (visible.length > 0) {
        setActive((active - 1 + visible.length) % visible.length, true);
      }
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(0, true);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(visible.length - 1, true);
      return;
    }
    if (event.key === "Enter") {
      const option = visible[active];
      if (option) {
        event.preventDefault();
        selectOption(option);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel(true);
      return;
    }
    if (event.key === "Tab") {
      closePanel(false);
    }
  });

  list.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const target = event.target as Element | null;
    const node = target?.closest<HTMLElement>('[role="option"]');
    if (!node) {
      return;
    }
    const index = Number(node.dataset.index);
    const option = visible[index];
    if (option) {
      selectOption(option);
    }
  });

  googleButton.addEventListener("click", () => {
    void loadGoogle();
  });

  googleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadGoogle();
    }
  });

  async function loadGoogle(): Promise<void> {
    const family = sanitizeFamily(googleInput.value);
    error.hidden = true;
    if (!family) {
      error.textContent = "Informe um nome de fonte válido.";
      error.hidden = false;
      return;
    }
    googleButton.disabled = true;
    try {
      const selection = await loadGoogleFamily(family);
      selectedFamily = selection.family;
      selectedStack = selection.stack;
      updateTrigger();
      googleInput.value = "";
      closePanel(true);
      config.onChange({
        family: selection.family,
        stack: selection.stack,
        source: "google",
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.message === "google-font-timeout";
      error.textContent = timedOut
        ? "A fonte demorou demais para carregar."
        : "Não foi possível carregar essa fonte do Google Fonts.";
      error.hidden = false;
    } finally {
      googleButton.disabled = false;
    }
  }

  updateTrigger();
  render();

  return {
    root,
    setValue(family: string, stack?: string): void {
      selectedFamily = family;
      selectedStack = stack ?? "";
      updateTrigger();
      render();
    },
    setDisabled(disabled: boolean): void {
      config.disabled = disabled;
      trigger.disabled = disabled;
      root.classList.toggle("is-disabled", disabled);
      if (disabled) {
        closePanel(false);
      }
    },
    destroy(): void {
      if (outsideHandler) {
        document.removeEventListener("pointerdown", outsideHandler, true);
        outsideHandler = null;
      }
      root.remove();
    },
  };
}
