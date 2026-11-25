/**
 * Rotas internas do modal de configurações.
 *
 * As rotas só existem enquanto o modal está aberto; o formato é
 * `#/temas[/importar]`, `#/aparencia`, `#/sistema`, `#/widgets` e
 * `#/widgets/<bloco>`. Rotas legadas (`#/codigo`, `#/graficos`, ...) são
 * redirecionadas para a seção equivalente; `#/aparencia/tema` continua
 * aceito e aponta para a página Temas. Este módulo é puro para poder ser
 * testado sem DOM.
 */

export const SETTINGS_SECTIONS = ["temas", "aparencia", "widgets", "sistema"] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const TEMAS_ANCHORS = ["importar"] as const;

export type TemasAnchor = (typeof TEMAS_ANCHORS)[number];

export const WIDGET_ANCHORS = ["graficos", "tabelas", "diff"] as const;

export type WidgetAnchor = (typeof WIDGET_ANCHORS)[number];

export type SettingsAnchor = TemasAnchor | WidgetAnchor;

export interface SettingsRoute {
  section: SettingsSection;
  anchor: SettingsAnchor | null;
}

export const DEFAULT_ROUTE: SettingsRoute = { section: "aparencia", anchor: null };

const LEGACY_ROUTES: Record<string, SettingsRoute> = {
  codigo: { section: "aparencia", anchor: null },
  graficos: { section: "widgets", anchor: "graficos" },
  tabelas: { section: "widgets", anchor: "tabelas" },
  diff: { section: "widgets", anchor: "diff" },
};

/** Old paths kept only so a saved last-route keeps working. */
const LEGACY_NESTED_ROUTES: Record<string, SettingsRoute> = {
  "aparencia/tema": { section: "temas", anchor: null },
};

function normalize(value: string): string {
  return value.trim().replace(/^#\/?/, "").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function isSection(value: string): value is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

function isTemasAnchor(value: string): value is TemasAnchor {
  return (TEMAS_ANCHORS as readonly string[]).includes(value);
}

function isWidgetAnchor(value: string): value is WidgetAnchor {
  return (WIDGET_ANCHORS as readonly string[]).includes(value);
}

/** Accepts the route body without `#/`, e.g. `temas/importar`. */
export function parseSettingsRouteString(
  value: string | null | undefined
): SettingsRoute | null {
  if (typeof value !== "string") {
    return null;
  }
  const path = normalize(value);
  if (path === "") {
    return null;
  }
  const legacyNested = LEGACY_NESTED_ROUTES[path];
  if (legacyNested) {
    return { ...legacyNested };
  }
  const parts = path.split("/");
  if (parts.length > 2) {
    return null;
  }
  const [section, anchor] = parts;

  if (section in LEGACY_ROUTES) {
    return parts.length === 1 ? { ...LEGACY_ROUTES[section] } : null;
  }
  if (!isSection(section)) {
    return null;
  }
  if (anchor === undefined) {
    return { section, anchor: null };
  }
  if (section === "temas" && isTemasAnchor(anchor)) {
    return { section, anchor };
  }
  if (section === "widgets" && isWidgetAnchor(anchor)) {
    return { section, anchor };
  }
  return null;
}

/** Accepts a full hash, e.g. `#/temas/importar`. */
export function parseSettingsRouteHash(hash: string | null | undefined): SettingsRoute | null {
  if (typeof hash !== "string" || !hash.startsWith("#")) {
    return null;
  }
  return parseSettingsRouteString(hash);
}

export function settingsRouteString(route: SettingsRoute): string {
  return route.anchor ? `${route.section}/${route.anchor}` : route.section;
}

export function settingsRouteHash(route: SettingsRoute): string {
  return `#/${settingsRouteString(route)}`;
}

export function sameSettingsRoute(
  left: SettingsRoute | null,
  right: SettingsRoute | null
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.section === right.section && left.anchor === right.anchor;
}

export function sectionLabel(section: SettingsSection): string {
  switch (section) {
    case "temas":
      return "Temas";
    case "aparencia":
      return "Aparência";
    case "sistema":
      return "Sistema";
    case "widgets":
      return "Widgets";
  }
}

export function routeLabel(route: SettingsRoute): string {
  if (route.section === "temas" && route.anchor === "importar") {
    return "Importar";
  }
  return sectionLabel(route.section);
}
