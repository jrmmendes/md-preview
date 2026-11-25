/**
 * Página Sistema (Fase 7).
 *
 * O daemon é somente leitura: porta, inatividade, seed e caminhos vêm do
 * payload da página e exigem reinício para mudar. A única ação é "Restaurar
 * padrões", que limpa apenas as preferências locais listadas no plano.
 */
import type { PageConfigPayload } from "../../../../core/contract";
import { copyText } from "../../clipboard";
import {
  button,
  contentBlock,
  el,
  icon,
  sectionHeader,
  toast,
} from "../components";

/** Local preferences owned by the settings modal (width/collapse stay). */
const MANAGED_LOCAL_KEYS = [
  "mdprv_font",
  "mdprv_loader",
  "mdprv_blocks",
  "mdprv_shiki",
  "mdprv_mermaid",
  "mdprv_zoom_sensitivity",
  "mdprv_simple_table",
  "mdprv_simple_diff",
  "mdprv_table_wrap",
] as const;

const MANAGED_COOKIES = ["mdprv_theme", "mdprv_prefs"] as const;

function removeLocal(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

function removeCookie(name: string): void {
  try {
    document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

function clearManagedPreferences(): void {
  for (const key of MANAGED_LOCAL_KEYS) {
    removeLocal(key);
  }
  for (const cookie of MANAGED_COOKIES) {
    removeCookie(cookie);
  }
  // Drop `?theme=` so the reload falls back to the configured default theme.
  const url = new URL(location.href);
  url.searchParams.delete("theme");
  history.replaceState(
    history.state,
    "",
    `${url.pathname}${url.search}`
  );
}

function restoreDefaults(): void {
  clearManagedPreferences();
  toast("Preferências restauradas");
  window.setTimeout(() => window.location.reload(), 320);
}

function infoRow(options: {
  label: string;
  description?: string;
  value: string;
}): HTMLElement {
  return el(
    "div",
    { class: "mdprv-settings-info-row" },
    el(
      "div",
      { class: "mdprv-settings-info-copy" },
      el("span", { class: "mdprv-settings-info-label" }, options.label),
      options.description
        ? el("span", { class: "mdprv-settings-info-desc" }, options.description)
        : null
    ),
    el("span", { class: "mdprv-settings-info-value" }, options.value)
  );
}

function pathRow(options: { label: string; value: string }): HTMLElement {
  const copyButton = el(
    "button",
    {
      type: "button",
      class: "mdprv-settings-path-copy",
      "aria-label": `Copiar ${options.label.toLowerCase()}`,
      title: "Copiar caminho",
      onclick: () => {
        copyText(options.value).then(
          () => toast("Caminho copiado"),
          () => toast("Não foi possível copiar")
        );
      },
    },
    icon("copy", 14)
  );

  return el(
    "div",
    { class: "mdprv-settings-path-row" },
    el("span", { class: "mdprv-settings-path-label" }, options.label),
    el("code", { class: "mdprv-settings-path-value" }, options.value),
    copyButton
  );
}

export function renderSistemaPage(config: PageConfigPayload | null): HTMLElement {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(
    sectionHeader({
      title: "Sistema",
      description: "Parâmetros do daemon local e caminhos usados pelo md-preview.",
    })
  );

  const daemonChildren: HTMLElement[] = [];
  if (config) {
    daemonChildren.push(
      infoRow({
        label: "Porta",
        description: "Porta do servidor local. 0 = porta efêmera.",
        value: config.port === 0 ? "0 (efêmera)" : String(config.port),
      }),
      infoRow({
        label: "Inatividade",
        description: "Minutos sem abas conectadas antes de o daemon encerrar.",
        value: `${config.idleMinutes} min`,
      }),
      infoRow({
        label: "Copiar temas embutidos ao iniciar",
        description: "Copia os temas embutidos para o diretório de temas quando o daemon inicia.",
        value: config.seedThemes ? "Ativado" : "Desativado",
      })
    );
  } else {
    daemonChildren.push(
      el(
        "p",
        { class: "mdprv-settings-note" },
        icon("info", 13),
        el("span", {}, "Configuração do daemon indisponível nesta página.")
      )
    );
  }
  daemonChildren.push(
    el(
      "p",
      { class: "mdprv-settings-note" },
      icon("info", 13),
      el(
        "span",
        {},
        "Somente leitura. Estes valores vêm de config.json e das variáveis MDPRV_*; alterações exigem reiniciar o daemon."
      )
    )
  );

  fragment.appendChild(
    contentBlock({
      title: "Daemon",
      description:
        "Valores equivalentes a config.json. Variáveis MDPRV_* têm prioridade sobre o arquivo.",
      children: daemonChildren,
    })
  );

  const paths: Array<{ label: string; value: string }> = config
    ? [
        { label: "Arquivo de configuração", value: config.paths.config },
        { label: "Diretório de temas", value: config.paths.themes },
        { label: "Arquivo de estado", value: config.paths.state },
      ]
    : [];

  fragment.appendChild(
    contentBlock({
      title: "Caminhos",
      description: "Locais somente leitura usados pelo daemon e pelos temas.",
      children:
        paths.length > 0
          ? [el("div", { class: "mdprv-settings-path-list" }, paths.map(pathRow))]
          : [
              el(
                "p",
                { class: "mdprv-settings-note" },
                icon("info", 13),
                el("span", {}, "Os caminhos não estão disponíveis nesta página.")
              ),
            ],
    })
  );

  fragment.appendChild(
    contentBlock({
      title: "Restaurar",
      description:
        "Limpa as preferências de aparência e de widgets deste navegador e recarrega no tema padrão. Largura e colunas recolhidas são mantidas.",
      children: [
        el(
          "div",
          { class: "mdprv-settings-btn-row" },
          button({
            label: "Restaurar padrões",
            iconName: "reset",
            variant: "danger",
            onClick: restoreDefaults,
          })
        ),
      ],
    })
  );

  return el("div", { class: "mdprv-settings-page" }, fragment);
}
