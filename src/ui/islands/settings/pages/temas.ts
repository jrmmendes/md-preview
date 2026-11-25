/**
 * Página Temas: seleção do tema de cores do documento.
 *
 * A grade e a aplicação ao vivo saíram da página Aparência; a mutação continua
 * no `index.ts` (`selectTheme`) para não duplicar a lógica de cookie, CSS e
 * sincronização dos blocos herdados.
 */
import {
  blockImportAction,
  contentBlock,
  el,
  icon,
  sectionHeader,
  themeGrid,
} from "../components";
import { themeLabel, type PageThemeData } from "../catalog";

export interface ThemesContext {
  data: PageThemeData;
  themeName: string;
  selectTheme(name: string): void;
  openImportPage(): void;
}

export function renderThemesPage(ctx: ThemesContext): HTMLElement {
  const items = ctx.data.catalog.map((entry) => ({
    id: entry.name,
    name: themeLabel(entry.name),
    note: entry.kind === "auto" ? "Segue o sistema" : undefined,
    colors: entry.swatch,
  }));

  return el(
    "div",
    { class: "mdprv-settings-page" },
    sectionHeader({
      title: "Temas",
      description: "Escolha o tema de cores do documento e do painel.",
    }),
    contentBlock({
      title: "Tema",
      description:
        "Cada tema define cores, fonte, loader, código e gráficos. Auto acompanha a preferência do sistema.",
      actions: blockImportAction(ctx.openImportPage),
      children: [
        themeGrid({
          label: "Tema",
          items,
          value: ctx.themeName,
          onChange: (name) => ctx.selectTheme(name),
        }),
        el(
          "p",
          { class: "mdprv-settings-legend" },
          "Personalize fonte, loader, código e gráficos em Aparência para sobrescrever o preset do tema."
        ),
        el(
          "p",
          { class: "mdprv-settings-note" },
          icon("info", 13),
          el(
            "span",
            {},
            "Temas em ~/.config/md-preview/themes sobrescrevem os embutidos."
          )
        ),
      ],
    })
  );
}
