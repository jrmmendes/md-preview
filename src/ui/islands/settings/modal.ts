/**
 * Estrutura e comportamento do diálogo de configurações.
 *
 * Responsabilidades: montar backdrop/modal/sidebar, prender o foco, fechar por
 * ESC/backdrop, salvar e restaurar o hash do documento. O conteúdo das páginas
 * vem do `index.ts`.
 */
import { el, getFocusable, icon, type IconName } from "./components";
import {
  DEFAULT_ROUTE,
  parseSettingsRouteHash,
  routeLabel,
  sameSettingsRoute,
  sectionLabel,
  settingsRouteHash,
  type SettingsRoute,
  type SettingsSection,
} from "./routes";

const SECTION_ICONS: Record<SettingsSection, IconName> = {
  temas: "layers",
  aparencia: "palette",
  emojis: "smile",
  icons: "palette",
  sistema: "terminal",
  widgets: "activity",
};

const TOP_LEVEL_SECTIONS: SettingsSection[] = [
  "aparencia",
  "emojis",
  "icons",
  "widgets",
  "sistema",
];

export interface SettingsModalOptions {
  root: HTMLElement;
  trigger: HTMLElement | null;
  onOpen(route: SettingsRoute): void;
  onNavigate(route: SettingsRoute): void;
  onClose(): void;
  onSave(): void;
  /** Lets the owner hold the dialog open while a save is being applied. */
  canClose?(): boolean;
}

export interface SettingsModalHandle {
  open(route: SettingsRoute, focus?: boolean): void;
  close(): void;
  isOpen(): boolean;
  currentRoute(): SettingsRoute;
  navigate(route: SettingsRoute): void;
  render(content: HTMLElement, route: SettingsRoute): void;
  scrollToAnchor(anchor: string): void;
  setDirty(dirty: boolean): void;
}

export function createSettingsModal(options: SettingsModalOptions): SettingsModalHandle {
  let open = false;
  let currentRoute: SettingsRoute = { ...DEFAULT_ROUTE };
  let savedHash = "";
  let activeNav: HTMLButtonElement | null = null;
  let lastFocused: HTMLElement | null = null;
  let closeTimer = 0;
  let focusTimer = 0;

  const nav = el("nav", {
    class: "mdprv-settings-nav",
    id: "mdprv-settings-nav",
    "aria-label": "Seções de configurações",
  });

  const appCard = el(
    "div",
    { class: "mdprv-settings-app-card" },
    el("span", { class: "mdprv-settings-app-mark", "aria-hidden": "true" }, icon("file", 17)),
    el(
      "div",
      { class: "mdprv-settings-app-id" },
      el("span", { class: "mdprv-settings-app-name" }, "md-preview"),
      el("span", { class: "mdprv-settings-app-meta" }, "Servidor local")
    ),
    el("span", {
      class: "mdprv-settings-app-live",
      title: "Servidor local ativo",
      "aria-label": "Servidor local ativo",
    })
  );

  const sidebar = el(
    "aside",
    { class: "mdprv-settings-sidebar" },
    el(
      "div",
      { class: "mdprv-settings-sidebar-top" },
      el(
        "div",
        { class: "mdprv-settings-sidebar-heading" },
        el("span", {}, "Configurações"),
        el("span", { class: "mdprv-settings-esc", "aria-hidden": "true" }, "ESC")
      )
    ),
    el("div", { class: "mdprv-settings-sidebar-scroll" }, appCard, nav),
    el(
      "div",
      { class: "mdprv-settings-sidebar-footer" },
      el(
        "span",
        { class: "mdprv-settings-sidebar-brand" },
        el("span", { class: "mdprv-settings-dot" }),
        "Config local"
      ),
      el("span", { class: "mdprv-settings-mono" }, "config.json")
    )
  );

  const announcer = el("p", {
    class: "mdprv-sr-only",
    id: "mdprv-settings-announcer",
    "aria-live": "polite",
  });

  const scroll = el("div", {
    class: "mdprv-settings-scroll",
    id: "mdprv-settings-scroll",
    tabindex: "-1",
  });

  // The save button keeps its box while hidden: toggling `hidden` would push
  // the close button whenever the draft became dirty.
  const saveButton = el(
    "button",
    {
      type: "button",
      class: ["mdprv-settings-save", "is-hidden"],
      "aria-label": "Salvar alterações",
      title: "Salvar alterações (Ctrl+S)",
      "aria-hidden": "true",
      tabindex: "-1",
      disabled: true,
      onclick: () => options.onSave(),
    },
    icon("save", 15)
  );

  const closeButton = el(
    "button",
    {
      type: "button",
      class: "mdprv-settings-close",
      "aria-label": "Fechar configurações",
      title: "Fechar (Esc)",
      onclick: () => handle.close(),
    },
    icon("close", 15)
  );

  const actions = el(
    "div",
    { class: "mdprv-settings-actions" },
    saveButton,
    closeButton
  );

  const dirtyStatus = el("p", {
    class: "mdprv-sr-only",
    id: "mdprv-settings-dirty-status",
    "aria-live": "polite",
  });

  const toastNode = el("div", {
    class: "mdprv-settings-toast",
    id: "mdprv-settings-toast",
    role: "status",
    "aria-live": "polite",
  });

  const modal = el(
    "div",
    {
      class: "mdprv-settings-modal",
      id: "mdprv-settings-dialog",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "mdprv-settings-dialog-title",
      tabindex: "-1",
    },
    el("h2", { class: "mdprv-sr-only", id: "mdprv-settings-dialog-title" }, "Configurações do md-preview"),
    sidebar,
    el(
      "section",
      { class: "mdprv-settings-content", "aria-label": "Conteúdo das configurações" },
      actions,
      scroll,
      announcer,
      dirtyStatus,
      toastNode
    )
  );

  const backdrop = el(
    "div",
    {
      class: "mdprv-settings-backdrop",
      id: "mdprv-settings-backdrop",
      hidden: true,
    },
    modal
  );

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) {
      handle.close();
    }
  });

  function navItem(options: {
    section: SettingsSection;
    anchor: string | null;
    label: string;
    className?: string;
    onClick: () => void;
  }): HTMLButtonElement {
    return el(
      "button",
      {
        type: "button",
        class: ["mdprv-settings-nav-item", options.className],
        dataset: {
          section: options.section,
          anchor: options.anchor ?? "",
        },
        onclick: options.onClick,
      },
      el("span", { class: "mdprv-settings-nav-icon" }, icon(SECTION_ICONS[options.section], 17)),
      el("span", { class: "mdprv-settings-nav-label" }, options.label)
    );
  }

  function renderNav(): void {
    nav.replaceChildren();

    // Temas is a branch: its parent opens the section and reveals the two
    // pages. The active subitem carries `aria-current="page"`.
    const temasChildren = el("div", {
      class: "mdprv-settings-nav-children",
      role: "group",
      "aria-label": "Temas",
    });
    temasChildren.append(
      navItem({
        section: "temas",
        anchor: null,
        label: "Temas",
        className: "mdprv-settings-nav-child",
        onClick: () => handle.navigate({ section: "temas", anchor: null }),
      }),
      navItem({
        section: "temas",
        anchor: "importar",
        label: "Importar",
        className: "mdprv-settings-nav-child",
        onClick: () => handle.navigate({ section: "temas", anchor: "importar" }),
      })
    );

    const temasParent = el(
      "button",
      {
        type: "button",
        class: "mdprv-settings-nav-item mdprv-settings-nav-parent",
        dataset: { section: "temas" },
        "aria-expanded": "false",
        "aria-controls": "mdprv-settings-nav-temas",
        onclick: () => handle.navigate({ section: "temas", anchor: null }),
      },
      el("span", { class: "mdprv-settings-nav-icon" }, icon(SECTION_ICONS.temas, 17)),
      el("span", { class: "mdprv-settings-nav-label" }, "Temas"),
      el("span", { class: "mdprv-settings-nav-chevron" }, icon("chevronDown", 14))
    );
    temasChildren.id = "mdprv-settings-nav-temas";

    nav.append(
      el(
        "div",
        { class: "mdprv-settings-nav-group", dataset: { group: "temas" } },
        temasParent,
        temasChildren
      )
    );

    for (const section of TOP_LEVEL_SECTIONS) {
      nav.appendChild(
        navItem({
          section,
          anchor: null,
          label: sectionLabel(section),
          onClick: () => handle.navigate({ section, anchor: null }),
        })
      );
    }
  }

  function updateActive(): void {
    const group = nav.querySelector<HTMLElement>(".mdprv-settings-nav-group");
    const parent = group?.querySelector<HTMLButtonElement>(".mdprv-settings-nav-parent");
    const children = group?.querySelector<HTMLElement>(".mdprv-settings-nav-children");
    const temasActive = currentRoute.section === "temas";
    if (group) {
      group.classList.toggle("is-open", temasActive);
    }
    if (parent) {
      parent.classList.toggle("is-branch-active", temasActive);
      parent.setAttribute("aria-expanded", String(temasActive));
    }
    if (children) {
      children.hidden = !temasActive;
    }

    const items = nav.querySelectorAll<HTMLButtonElement>(".mdprv-settings-nav-item");
    for (const item of items) {
      if (item === parent) {
        item.removeAttribute("aria-current");
        continue;
      }
      const child = item.classList.contains("mdprv-settings-nav-child");
      const active = child
        ? currentRoute.section === "temas" &&
          (item.dataset.anchor ?? "") === (currentRoute.anchor ?? "")
        : currentRoute.section === item.dataset.section;
      item.classList.toggle("is-active", active);
      if (active) {
        item.setAttribute("aria-current", "page");
        activeNav = item;
      } else {
        item.removeAttribute("aria-current");
      }
    }
  }

  function navControls(): HTMLButtonElement[] {
    return [...nav.querySelectorAll<HTMLButtonElement>(".mdprv-settings-nav-item")].filter(
      (item) => item.offsetParent !== null
    );
  }

  nav.addEventListener("keydown", (event) => {
    const target = (event.target as HTMLElement).closest(".mdprv-settings-nav-item");
    if (!target) {
      return;
    }
    const controls = navControls();
    const index = controls.indexOf(target as HTMLButtonElement);
    if (index < 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      controls[(index + 1) % controls.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      controls[(index - 1 + controls.length) % controls.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      controls[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      controls[controls.length - 1]?.focus();
    }
  });

  function focusActive(): void {
    (activeNav?.isConnected ? activeNav : closeButton).focus();
  }

  function focusable(): HTMLElement[] {
    return getFocusable(modal);
  }

  function trapFocus(event: KeyboardEvent): void {
    const nodes = focusable();
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !modal.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function setDirty(dirty: boolean): void {
    modal.classList.toggle("is-dirty", dirty);
    saveButton.disabled = !dirty;
    saveButton.classList.toggle("is-hidden", !dirty);
    saveButton.setAttribute("aria-hidden", String(!dirty));
    saveButton.tabIndex = dirty ? 0 : -1;
    if (dirty) {
      if (dirtyStatus.textContent !== "Alterações não salvas") {
        dirtyStatus.textContent = "Alterações não salvas";
      }
    } else {
      dirtyStatus.textContent = "";
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!open) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      handle.close();
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      (event.key === "s" || event.key === "S")
    ) {
      event.preventDefault();
      options.onSave();
      return;
    }
    if (event.key === "Tab") {
      trapFocus(event);
    }
  }

  /**
   * `overflow:hidden` on the body removes the page scrollbar, which would widen
   * the viewport and shift centered content. Measure the gutter first and let
   * `html { padding-right }` keep the exact same content width.
   */
  function lockScroll(): void {
    const gutter = Math.max(
      0,
      window.innerWidth - document.documentElement.clientWidth
    );
    document.documentElement.style.setProperty(
      "--mdprv-scrollbar-gutter",
      `${gutter}px`
    );
    // The html class also scopes the document-wide widget flags out while the
    // modal is open, so the preview wrapper alone drives the live preview.
    document.documentElement.classList.add("mdprv-settings-open");
    document.body.classList.add("mdprv-settings-open");
  }

  function unlockScroll(): void {
    document.documentElement.classList.remove("mdprv-settings-open");
    document.body.classList.remove("mdprv-settings-open");
    document.documentElement.style.removeProperty("--mdprv-scrollbar-gutter");
  }

  function routeHash(route: SettingsRoute): string {
    return settingsRouteHash(route);
  }

  function writeHash(route: SettingsRoute): void {
    const next = `${location.pathname}${location.search}${routeHash(route)}`;
    history.replaceState(history.state, "", next);
  }

  function restoreHash(): void {
    const target = savedHash !== "" && savedHash !== "#" ? savedHash : "";
    history.replaceState(history.state, "", `${location.pathname}${location.search}${target}`);
    savedHash = "";
  }

  const handle: SettingsModalHandle = {
    open(route, focus = true) {
      window.clearTimeout(closeTimer);
      window.clearTimeout(focusTimer);
      if (open) {
        if (focus) {
          focusActive();
        }
        return;
      }
      const source = document.activeElement;
      lastFocused =
        source instanceof HTMLElement && source !== document.body
          ? source
          : options.trigger;
      const existing = location.hash;
      savedHash = parseSettingsRouteHash(existing) ? "" : existing;
      currentRoute = route;
      open = true;
      setDirty(false);
      backdrop.hidden = false;
      backdrop.classList.remove("is-closing");
      void backdrop.offsetWidth;
      backdrop.classList.add("is-open");
      lockScroll();
      options.trigger?.setAttribute("aria-expanded", "true");
      writeHash(route);
      options.onOpen(route);
      if (focus) {
        focusTimer = window.setTimeout(() => {
          if (open) {
            focusActive();
          }
        }, 40);
      }
    },
    close() {
      if (!open) {
        return;
      }
      if (options.canClose && !options.canClose()) {
        return;
      }
      open = false;
      window.clearTimeout(focusTimer);
      backdrop.classList.remove("is-open");
      backdrop.classList.add("is-closing");
      unlockScroll();
      options.trigger?.setAttribute("aria-expanded", "false");
      restoreHash();
      options.onClose();
      const restore = lastFocused;
      closeTimer = window.setTimeout(() => {
        backdrop.hidden = true;
        backdrop.classList.remove("is-closing");
        if (!open && restore?.isConnected) {
          restore.focus();
        }
      }, 190);
    },
    isOpen() {
      return open;
    },
    currentRoute() {
      return currentRoute;
    },
    navigate(route) {
      currentRoute = route;
      writeHash(route);
      options.onNavigate(route);
    },
    render(content, route) {
      currentRoute = route;
      scroll.replaceChildren(content);
      scroll.scrollTop = 0;
      updateActive();
      announcer.textContent = routeLabel(route);
    },
    scrollToAnchor(anchor) {
      const target = document.getElementById(`mdprv-settings-widgets-${anchor}`);
      if (!target) {
        return;
      }
      const top =
        target.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop -
        8;
      scroll.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    },
    setDirty,
  };

  renderNav();
  options.root.appendChild(backdrop);
  document.addEventListener("keydown", onKeydown);

  // Clicking the existing trigger opens the modal; the trigger stays in the
  // shell so `Ctrl+,` and the button share the same entry point.
  options.trigger?.addEventListener("click", () => {
    if (handle.isOpen()) {
      handle.close();
    } else {
      const route = parseSettingsRouteHash(location.hash);
      handle.open(route ?? currentRoute ?? DEFAULT_ROUTE);
    }
  });

  return handle;
}

export { sameSettingsRoute };
