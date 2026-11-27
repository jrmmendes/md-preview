/**
 * Componentes de DOM do modal de configurações (sem framework).
 *
 * Todos os nomes de classe usam o prefixo `mdprv-settings-` para não vazar
 * regras para o documento.
 */
import { LOADERS, type LoaderName } from "../../../core/loader";

type Child = Node | string | null | undefined | false | Child[];

type Attrs = Record<string, unknown>;

let uidCounter = 0;

export function uid(prefix = "mdprv-settings"): string {
  uidCounter += 1;
  return `${prefix}-${uidCounter}`;
}

function appendChildren(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (Array.isArray(child)) {
      appendChildren(node, child);
      continue;
    }
    node.appendChild(
      child instanceof Node ? child : document.createTextNode(String(child))
    );
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === "class") {
      const classes = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string" && item !== "").join(" ")
        : String(value);
      if (classes !== "") {
        node.className = classes;
      }
      continue;
    }
    if (key === "text") {
      node.textContent = String(value);
      continue;
    }
    if (key === "html") {
      node.innerHTML = String(value);
      continue;
    }
    if (key === "dataset") {
      Object.assign(node.dataset, value as Record<string, string>);
      continue;
    }
    if (key === "style" && typeof value === "object" && value !== null) {
      for (const [prop, propValue] of Object.entries(value as Record<string, string>)) {
        const name = prop.startsWith("--")
          ? prop
          : prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
        node.style.setProperty(name, propValue);
      }
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(
        key.slice(2).toLowerCase(),
        value as EventListener
      );
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }

  appendChildren(node, children);
  return node;
}

const ICONS = {
  close: '<path d="M18 6 6 18M6 6l12 12"></path>',
  chevronDown: '<path d="m6 9 6 6 6-6"></path>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M8 13h8M8 17h5"></path>',
  palette:
    '<path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h6.5A3.5 3.5 0 0 0 22 8.5 9 9 0 0 0 12 3z"></path><circle cx="7.5" cy="10" r="1"></circle><circle cx="10" cy="6.5" r="1"></circle><circle cx="15" cy="6.5" r="1"></circle>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m7 10 3 3-3 3M13 16h4"></path>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"></path>',
  smile:
    '<circle cx="12" cy="12" r="9"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><path d="M9 9h.01M15 9h.01"></path>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 10h18M9 4v16M15 4v16"></path>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"></path>',
  diff: '<path d="M7 4v11a3 3 0 0 0 3 3h7"></path><path d="m14 15 3 3-3 3"></path><path d="M17 20V9a3 3 0 0 0-3-3H7"></path><path d="M10 3 7 6l3 3"></path>',
  layers: '<path d="m12 2 9 5-9 5-9-5z"></path><path d="m3 12 9 5 9-5"></path><path d="m3 17 9 5 9-5"></path>',
  check: '<path d="m20 6-11 11-5-5"></path>',
  info: '<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5M12 8h.01"></path>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path>',
  pencil:
    '<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"></path>',
  trash:
    '<path d="M3 6h18"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M10 11v6M14 11v6"></path>',
  import:
    '<path d="M12 3v10"></path><path d="m8 9 4 4 4-4"></path><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><path d="M17 21v-8H7v8"></path><path d="M7 3v5h8"></path>',
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 17): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = ICONS[name];
  return svg;
}

export function button(options: {
  label: string;
  iconName?: IconName;
  variant?: "secondary" | "danger";
  onClick?: () => void;
}): HTMLButtonElement {
  const node = el("button", {
    type: "button",
    class: [
      "mdprv-settings-btn",
      options.variant === "danger" ? "mdprv-settings-btn--danger" : "",
    ],
    onclick: options.onClick,
  });
  if (options.iconName) {
    node.appendChild(icon(options.iconName, 15));
  }
  node.appendChild(el("span", {}, options.label));
  return node;
}

export interface IconMenuOption {
  value: string;
  label: string;
}

export interface IconMenuOptions {
  label: string;
  iconName?: IconName;
  options: IconMenuOption[];
  value: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

export function iconMenu(config: IconMenuOptions): HTMLElement {
  const menuId = uid("mdprv-settings-menu");
  const wrap = el("div", { class: ["mdprv-settings-icon-menu", config.className] });
  let current = config.options.some((option) => option.value === config.value)
    ? config.value
    : config.options[0]?.value ?? "";
  let isOpen = false;

  const nodes = config.options.map((option) => {
    const item = el(
      "button",
      {
        type: "button",
        class: "mdprv-settings-icon-menu-item",
        role: "menuitemradio",
        tabindex: "-1",
        "aria-checked": String(option.value === current),
        dataset: { value: option.value },
      },
      el(
        "span",
        { class: "mdprv-settings-icon-menu-check", "aria-hidden": "true" },
        icon("check", 13)
      ),
      el("span", { class: "mdprv-settings-icon-menu-text" }, option.label)
    );
    item.addEventListener("click", () => {
      if (option.value === current) {
        closeMenu(true);
        return;
      }
      current = option.value;
      sync();
      closeMenu(true);
      config.onChange?.(option.value);
    });
    return item;
  });

  const list = el(
    "div",
    {
      class: "mdprv-settings-icon-menu-list",
      role: "menu",
      id: menuId,
      "aria-label": config.label,
      hidden: true,
    },
    ...nodes
  );

  const trigger = el(
    "button",
    {
      type: "button",
      class: "mdprv-settings-icon-menu-button",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-controls": menuId,
      "aria-label": config.label,
      title: config.label,
      disabled: config.disabled === true,
    },
    icon(config.iconName ?? "palette", 17)
  );

  if (config.disabled) {
    wrap.classList.add("is-disabled");
  }

  function items(): HTMLButtonElement[] {
    return [...list.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
  }

  function sync(): void {
    for (const node of nodes) {
      node.setAttribute(
        "aria-checked",
        String((node as HTMLElement).dataset.value === current)
      );
    }
  }

  function position(): void {
    list.classList.remove("is-up");
    const rect = trigger.getBoundingClientRect();
    const height = list.offsetHeight;
    const below = window.innerHeight - rect.bottom;
    const above = rect.top;
    if (height + 8 > below && above > below) {
      list.classList.add("is-up");
    }
  }

  function onOutside(event: Event): void {
    if (!wrap.contains(event.target as Node)) {
      closeMenu(false);
    }
  }

  function onResize(): void {
    closeMenu(false);
  }

  function openMenu(focusLast = false): void {
    if (isOpen) {
      return;
    }
    isOpen = true;
    list.hidden = false;
    wrap.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    position();
    document.addEventListener("pointerdown", onOutside, true);
    window.addEventListener("resize", onResize);
    const all = items();
    const target =
      all.find((item) => item.getAttribute("aria-checked") === "true") ??
      all[focusLast ? all.length - 1 : 0];
    target?.focus();
  }

  function closeMenu(restoreFocus = false): void {
    if (!isOpen) {
      if (restoreFocus) {
        trigger.focus();
      }
      return;
    }
    isOpen = false;
    list.hidden = true;
    wrap.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.remove("is-up");
    document.removeEventListener("pointerdown", onOutside, true);
    window.removeEventListener("resize", onResize);
    if (restoreFocus) {
      trigger.focus();
    }
  }

  trigger.addEventListener("click", () => {
    if (config.disabled) {
      return;
    }
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(true);
    }
  });

  list.addEventListener("keydown", (event) => {
    const all = items();
    const index = all.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      all[(index + 1) % all.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      all[(index - 1 + all.length) % all.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      all[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      all[all.length - 1]?.focus();
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      (document.activeElement as HTMLButtonElement | null)?.click();
    } else if (event.key === "Tab") {
      closeMenu(true);
    }
  });

  wrap.append(trigger, list);
  return wrap;
}

/**
 * Single-line toggle row used by the Widgets page: switch first, then the bold
 * label and its description after a colon on the same line (prototype style).
 */
export function switchRow(options: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}): HTMLElement {
  const id = options.id ?? uid("mdprv-settings-switch");
  const descriptionId = options.description ? uid("mdprv-settings-desc") : null;
  const control = el("button", {
    type: "button",
    class: "mdprv-settings-switch",
    id,
    role: "switch",
    "aria-checked": String(options.checked),
    "aria-label": options.label,
  });
  if (descriptionId) {
    control.setAttribute("aria-describedby", descriptionId);
  }
  control.appendChild(el("span", { class: "mdprv-settings-switch-knob" }));
  control.addEventListener("click", () => {
    const next = control.getAttribute("aria-checked") !== "true";
    control.setAttribute("aria-checked", String(next));
    options.onChange(next);
  });

  const labelNode = el("label", { class: "mdprv-settings-row-label", for: id }, options.label);
  labelNode.addEventListener("click", (event) => {
    // `label[for]` does not activate a <button>; forward the click explicitly.
    event.preventDefault();
    control.click();
  });

  const copy = el(
    "p",
    { class: "mdprv-settings-toggle-copy" },
    labelNode,
    el("span", { class: "mdprv-settings-toggle-sep", "aria-hidden": "true" }, ": "),
    options.description
      ? el(
          "span",
          { class: "mdprv-settings-row-desc", id: descriptionId ?? undefined },
          options.description
        )
      : null
  );

  return el(
    "div",
    { class: "mdprv-settings-toggle-row" },
    el("span", { class: "mdprv-settings-row-control" }, control),
    copy
  );
}

export function sectionHeader(options: {
  title: string;
  description?: string;
}): HTMLElement {
  return el(
    "div",
    { class: "mdprv-settings-page-head" },
    el(
      "div",
      {},
      el("h2", { tabindex: "-1" }, options.title),
      options.description
        ? el("p", { class: "mdprv-settings-page-desc" }, options.description)
        : null
    )
  );
}

export function toast(message: string): void {
  const node = document.getElementById("mdprv-settings-toast");
  if (!node) {
    return;
  }
  node.textContent = message;
  node.classList.add("is-visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => node.classList.remove("is-visible"), 2400);
}

let toastTimer = 0;

export function announce(message: string): void {
  const node = document.getElementById("mdprv-settings-announcer");
  if (node) {
    node.textContent = message;
  }
}

export interface ThemeGridItem {
  id: string;
  name: string;
  note?: string;
  colors: { background: string; text: string; accent: string };
}

export function themeGrid(options: {
  label?: string;
  items: ThemeGridItem[];
  value: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const group = el("div", {
    class: "mdprv-settings-theme-grid",
    role: "radiogroup",
    "aria-label": options.label ?? "Tema",
  });
  const buttons: Array<{ id: string; node: HTMLButtonElement }> = [];

  const sync = (current: string): void => {
    for (const entry of buttons) {
      const selected = entry.id === current;
      entry.node.setAttribute("aria-checked", String(selected));
      entry.node.classList.toggle("is-selected", selected);
    }
  };

  for (const item of options.items) {
    const swatch = el(
      "span",
      {
        class: [
          "mdprv-settings-theme-swatch",
          item.id === "auto" ? "mdprv-settings-theme-swatch--auto" : "",
        ],
        style:
          item.id === "auto"
            ? {}
            : {
                background: item.colors.background,
                color: item.colors.text,
                "--theme-accent": item.colors.accent,
              },
      },
      item.id === "auto"
        ? el("span", { class: "mdprv-settings-theme-auto-glyph" }, "Aa")
        : [
            el("span", { class: "mdprv-settings-theme-swatch-title" }),
            el("span", { class: "mdprv-settings-theme-swatch-text" }),
            el("span", { class: "mdprv-settings-theme-swatch-dot" }),
          ]
    );

    const card = el(
      "button",
      {
        type: "button",
        class: [
          "mdprv-settings-theme-card",
          item.id === options.value ? "is-selected" : "",
        ],
        role: "radio",
        "aria-checked": String(item.id === options.value),
        "aria-label": item.note ? `${item.name}, ${item.note}` : item.name,
        dataset: { theme: item.id },
        onclick: () => {
          sync(item.id);
          options.onChange(item.id);
        },
      },
      swatch,
      el(
        "span",
        { class: "mdprv-settings-theme-card-meta" },
        el(
          "span",
          {},
          el("span", { class: "mdprv-settings-theme-card-name" }, item.name),
          item.note
            ? el("span", { class: "mdprv-settings-theme-card-note" }, item.note)
            : null
        ),
        el(
          "span",
          { class: "mdprv-settings-theme-card-check" },
          icon("check", 12)
        )
      )
    );

    buttons.push({ id: item.id, node: card });
    group.appendChild(card);
  }

  group.addEventListener("keydown", (event) => {
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
        event.key
      )
    ) {
      return;
    }
    const index = buttons.findIndex(({ node }) => node === document.activeElement);
    if (index < 0) {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = (index + 1) % buttons.length;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + buttons.length) % buttons.length;
    }
    if (event.key === "Home") {
      next = 0;
    }
    if (event.key === "End") {
      next = buttons.length - 1;
    }
    buttons[next].node.focus();
    buttons[next].node.click();
  });

  sync(options.value);
  return group;
}

interface LoaderMeta {
  id: LoaderName;
  name: string;
  description: string;
}

export const LOADER_OPTIONS: LoaderMeta[] = [
  { id: "classic", name: "Classic", description: "Spinner clássico com arco girando." },
  { id: "dots", name: "Dots", description: "Três pontos quicando em sequência." },
  { id: "bars", name: "Bars", description: "Barras verticais pulsando." },
  { id: "ring", name: "Ring", description: "Anéis concêntricos expandindo." },
  { id: "pulse", name: "Pulse", description: "Círculo preenchido pulsando." },
  { id: "braille", name: "Braille", description: "Células braille acendendo." },
];

const LOADER_NAMES: readonly string[] = LOADERS;

export function isLoaderOption(value: string): value is LoaderName {
  return LOADER_NAMES.includes(value);
}

function loaderPreview(id: LoaderName): HTMLElement {
  // A escala fica no wrapper: o loader anima `transform` (ex.: `mdprv-spin`
  // gira o elemento) e um `transform` estático no próprio loader quebraria a
  // interpolação dos keyframes — o classic pulsava em vez de girar.
  return el(
    "span",
    { class: "mdprv-settings-loader-preview", "aria-hidden": "true" },
    el(
      "span",
      {
        class: [
          "mdprv-settings-loader-visual",
          id === "braille" ? "mdprv-settings-loader-visual--braille" : "",
        ],
      },
      el("span", { class: `mdprv-loader mdprv-loader--${id}` })
    )
  );
}

export function loaderGrid(options: {
  items?: LoaderMeta[];
  value: LoaderName;
  disabled?: boolean;
  onChange: (value: LoaderName) => void;
}): HTMLElement {
  const disabled = options.disabled === true;
  const items = options.items ?? LOADER_OPTIONS;
  const group = el("div", {
    class: ["mdprv-settings-loader-grid", disabled ? "is-disabled" : ""],
    role: "radiogroup",
    "aria-label": "Loader",
    "aria-disabled": String(disabled),
  });
  const buttons: Array<{ id: LoaderName; node: HTMLButtonElement }> = [];

  const sync = (current: LoaderName): void => {
    for (const entry of buttons) {
      const selected = entry.id === current;
      entry.node.setAttribute("aria-checked", String(selected));
      entry.node.classList.toggle("is-selected", selected);
    }
  };

  for (const item of items) {
    const card = el(
      "button",
      {
        type: "button",
        class: [
          "mdprv-settings-loader-card",
          item.id === options.value ? "is-selected" : "",
        ],
        role: "radio",
        "aria-checked": String(item.id === options.value),
        "aria-label": `${item.name}: ${item.description}`,
        disabled,
        onclick: () => {
          if (disabled) {
            return;
          }
          sync(item.id);
          options.onChange(item.id);
        },
      },
      loaderPreview(item.id),
      el("span", { class: "mdprv-settings-loader-card-name" }, item.name),
      el("span", { class: "mdprv-settings-loader-card-desc" }, item.description)
    );
    buttons.push({ id: item.id, node: card });
    group.appendChild(card);
  }

  group.addEventListener("keydown", (event) => {
    if (disabled) {
      return;
    }
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
        event.key
      )
    ) {
      return;
    }
    const index = buttons.findIndex(({ node }) => node === document.activeElement);
    if (index < 0) {
      return;
    }
    event.preventDefault();
    let next = index;
    if (event.key === "ArrowRight") {
      next = (index + 1) % buttons.length;
    }
    if (event.key === "ArrowLeft") {
      next = (index - 1 + buttons.length) % buttons.length;
    }
    if (event.key === "ArrowDown") {
      next = (index + 3) % buttons.length;
    }
    if (event.key === "ArrowUp") {
      next = (index - 3 + buttons.length) % buttons.length;
    }
    if (event.key === "Home") {
      next = 0;
    }
    if (event.key === "End") {
      next = buttons.length - 1;
    }
    buttons[next].node.focus();
    buttons[next].node.click();
  });

  sync(options.value);
  return group;
}

function blockAction(options: {
  action: string;
  label: string;
  iconName: IconName;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}): HTMLButtonElement {
  return el(
    "button",
    {
      type: "button",
      class: [
        "mdprv-settings-block-action",
        options.active ? "is-active" : "",
      ],
      dataset: { action: options.action },
      title: options.label,
      "aria-label": options.label,
      "aria-pressed": String(options.active === true),
      disabled: options.disabled === true,
      onclick: options.onClick,
    },
    icon(options.iconName, 15)
  );
}

/** Import icon shared by blocks that use a theme catalog. */
export function blockImportAction(onImport: () => void): HTMLElement {
  return el(
    "div",
    {
      class: "mdprv-settings-block-actions",
      role: "group",
      "aria-label": "Ações do bloco",
    },
    blockAction({
      action: "import",
      label: "Importar tema…",
      iconName: "import",
      onClick: onImport,
    })
  );
}

export interface BlockMetaOptions {
  block: string;
  customized: boolean;
  onToggle: (checked: boolean) => void;
  onRestore: () => void;
  onImport?: () => void;
  /** Leading controls kept on the same row, e.g. the chart example menu. */
  extras?: HTMLElement[];
}

export function blockMeta(options: BlockMetaOptions): HTMLElement {
  const customizeLabel = options.customized
    ? "Personalizar: ativado"
    : "Personalizar: desativado";
  return el(
    "div",
    { class: "mdprv-settings-block-meta", dataset: { block: options.block } },
    options.extras ?? null,
    el(
      "div",
      {
        class: "mdprv-settings-block-actions",
        role: "group",
        "aria-label": "Ações do bloco",
      },
      blockAction({
        action: "customize",
        label: customizeLabel,
        iconName: "pencil",
        active: options.customized,
        onClick: () => options.onToggle(!options.customized),
      }),
      blockAction({
        action: "restore",
        label: "Restaurar do tema",
        iconName: "reset",
        disabled: !options.customized,
        onClick: options.onRestore,
      }),
      options.onImport
        ? blockAction({
            action: "import",
            label: "Importar tema…",
            iconName: "import",
            onClick: options.onImport,
          })
        : null
    )
  );
}

function blockHead(options: {
  title: string;
  description: string;
  actions?: HTMLElement | null;
}): HTMLElement {
  const title = el(
    "div",
    { class: "mdprv-settings-block-title" },
    el("h3", {}, options.title),
    el("p", {}, options.description)
  );
  if (!options.actions) {
    return el("div", { class: "mdprv-settings-block-head" }, title);
  }
  return el(
    "div",
    { class: "mdprv-settings-block-head mdprv-settings-block-head--split" },
    title,
    options.actions
  );
}

export function customizableBlock(options: {
  title: string;
  description: string;
  block: string;
  meta: HTMLElement;
  children: Child[];
}): HTMLElement {
  return el(
    "section",
    { class: "mdprv-settings-block", dataset: { block: options.block } },
    blockHead({
      title: options.title,
      description: options.description,
      actions: options.meta,
    }),
    ...options.children
  );
}

export function contentBlock(options: {
  title: string;
  description: string;
  actions?: HTMLElement | null;
  children: Child[];
}): HTMLElement {
  return el(
    "section",
    { class: "mdprv-settings-block" },
    blockHead({
      title: options.title,
      description: options.description,
      actions: options.actions,
    }),
    ...options.children
  );
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function getFocusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null
  );
}
