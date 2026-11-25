# Modal de configurações e tema completo

**Status:** aceito em 2026-11-25. Substitui o painel fixo da barra lateral.

## Contexto

O painel antigo era um bloco no `src/ui/index.html` com `select` de tema e loader,
um combobox de fonte e checkboxes de zoom/diff. Ele não cobria código (Shiki),
gráficos (Mermaid) nem parâmetros do daemon, e crescer mais no shell tornaria o
HTML inicial caro e difícil de manter.

O contrato de tema também passou a ser “tema completo”: `theme.json` agora pode
declarar `loader` (opcional; omitido = `classic`), além de cores, tipografia,
Shiki e Mermaid. Temas `auto` não declaram `loader`: cada variante traz o seu.

## Decisão

- O painel virou um modal montado em JavaScript dentro de
  `#mdprv-settings-root` (`src/ui/islands/settings/`). O shell só mantém o botão
  de engrenagem e o root.
- Quatro páginas, com **Temas** como seção própria: **Temas** (seleção e
  `Importar`), **Aparência** (fonte, loader, código, gráficos), **Sistema**
  (daemon e caminhos somente leitura, restaurar padrões) e **Widgets** (zoom,
  tabela simples, diff simples).
- A página **Importar** (`#/temas/importar`) concentra os três importadores:
  `theme.json`, `.shiki.json` e `.mermaid.json`. Os três usam o mesmo formulário
  (nome, arquivo/textarea, erro inline, lista de instalados com remover) e os
  endpoints já existentes (`/__themes`, `/__shiki-themes`,
  `/__mermaid-themes`). Importar só adiciona ao catálogo; a aplicação continua
  nos menus de Código/Gráficos e na grade de Temas.
- O modal segue o fluxo **rascunho → salvar**: tema, fonte, loader, Shiki,
  Mermaid, exemplo de gráfico, zoom, tabela simples e diff simples viram um
  snapshot em memória (`settings/draft.ts`). Nada toca o documento, cookies ou
  `localStorage` antes de **Salvar** (disquete ao lado do fechar ou
  `Ctrl/Cmd+S`). Sem alterações, o disquete fica oculto e o modal mantém a
  borda normal; com rascunho sujo, a borda fica `--mdprv-accent` e a região viva
  anuncia “Alterações não salvas”. Fechar por `Esc`, `X` ou backdrop descarta o
  rascunho e restaura o estado efetivo.
- As ações de cada bloco viraram ícones alinhados à direita do título:
  **lápis** (personalizar), **seta circular** (restaurar do tema, desabilitada
  quando o bloco segue o preset) e **importar** (só em Código, Gráficos e no
  bloco Tema da página Temas). Em Gráficos, o menu de exemplo fica na mesma
  linha, à esquerda dos ícones.
- Salvar aplica tudo de uma vez. Fonte, loader, zoom e modos simples entram ao
  vivo; Shiki/Mermaid/tema exigem o reload único, com loader e reabertura do
  modal na mesma rota.
- Personalizações ficam no navegador (`localStorage`/cookies), nunca em
  `config.json` ou `theme.json`. O esquema efetivo é explícito em
  `html[data-scheme]`, o que permite overrides de Shiki por esquema inclusive
  em temas fixos.
- `loader` no `config.json`/`MDPRV_LOADER` vence o preset do tema; sem escolha
  explícita, vale o `loader` do tema (`auto` escolhe pela variante clara/escura).
- A página Sistema é somente leitura; “Restaurar padrões” limpa apenas as
  preferências do modal e preserva largura e colunas recolhidas.

## Consequências

- O HTML inicial ficou menor: saem os placeholders `{{mdprv-theme-options}}` e
  `{{mdprv-loader-options}}`, os helpers `themeOptions`/`loaderOptions` e o
  binding do `select#mdprv-loader`.
- O modal depende de `#mdprv-data` (tema efetivo, catálogo e config do daemon) e
  reutiliza as islands reais (loader, tabela, diff) nas prévias.
- Rotas internas (`#/temas[/importar]`, `#/aparencia`,
  `#/widgets[/graficos|tabelas|diff]`, `#/sistema`) só existem com o modal
  aberto; o hash do documento é salvo e restaurado. `#/aparencia/tema` é aceito
  como apelido antigo e abre `#/temas`.
- Reloads forçados (SSE de tema/arquivo) preservam o modal aberto via
  `sessionStorage["mdprv_settings_open"]`; salvar com Shiki/Mermaid/tema grava
  a mesma chave para reabrir o modal na rota atual depois do reload.
