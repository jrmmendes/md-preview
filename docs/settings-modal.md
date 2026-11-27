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
- Cinco páginas, com **Temas** como seção própria: **Temas** (seleção e
  `Importar`), **Aparência** (fonte, loader, código, gráficos), **Emojis**
  (pacotes, seleção, prévia e importação), **Sistema** (daemon e caminhos
  somente leitura, restaurar padrões) e **Widgets** (zoom, tabela simples,
  quebra automática de linhas e diff simples).
- A página **Importar** (`#/temas/importar`) concentra os três importadores:
  `theme.json`, `.shiki.json` e `.mermaid.json`. Os três usam o mesmo formulário
  (nome, arquivo/textarea, erro inline, lista de instalados com remover) e os
  endpoints já existentes (`/__themes`, `/__shiki-themes`,
  `/__mermaid-themes`). Importar só adiciona ao catálogo; a aplicação continua
  nos menus de Código/Gráficos e na grade de Temas.
- O modal segue o fluxo **rascunho → salvar**: tema, fonte, loader, Shiki,
  Mermaid, pacote de emojis, exemplo de gráfico, zoom, tabela simples, quebra
  automática de linhas e diff simples viram um snapshot em memória
  (`settings/draft.ts`). Nada toca o documento, cookies ou `localStorage` antes
  de **Salvar** (disquete ao lado do
  fechar ou `Ctrl/Cmd+S`). Sem alterações, o disquete fica oculto e o modal
  mantém a borda normal; com rascunho sujo, a borda fica `--mdprv-accent` e a
  região viva anuncia “Alterações não salvas”. Fechar por `Esc`, `X` ou backdrop
  descarta o rascunho e restaura o estado efetivo.
- As ações de cada bloco viraram ícones alinhados à direita do título:
  **lápis** (personalizar), **seta circular** (restaurar do tema, desabilitada
  quando o bloco segue o preset) e **importar** (só em Código, Gráficos e no
  bloco Tema da página Temas). Em Gráficos, o menu de exemplo fica na mesma
  linha, à esquerda dos ícones.
- Salvar aplica tudo de uma vez. Fonte, loader, zoom, tabela simples, quebra
  automática de linhas e diff simples entram ao vivo; Shiki/Mermaid/tema/pacote
  de emojis exigem o reload único, com loader e reabertura do modal na mesma
  rota. O pacote de emojis vai para o cookie `mdprv_emoji` e um `?emoji=`
  explícito é removido da URL.
- A página **Emojis** lista pacotes embutidos e de usuário com origem, `style`,
  número de shortcodes e `license`/`attribution`. A seleção só entra no
  rascunho; a prévia (grade de amostras) é buscada sob demanda em
  `GET /__emoji-samples/<pacote>` e usa a mesma regra do render (SVG quando
  existir, senão Unicode). Importar aceita um JSON único de até 256 KiB e só
  adiciona ao catálogo; remover um pacote de usuário pede confirmação e nunca
  afeta o embutido. O evento SSE `emojis` atualiza essa página in-place, sem
  re-render destrutivo.
- Personalizações ficam no navegador (`localStorage`/cookies), nunca em
  `config.json` ou `theme.json`. O esquema efetivo é explícito em
  `html[data-scheme]`, o que permite overrides de Shiki por esquema inclusive
  em temas fixos.
- A quebra automática de linhas usa `localStorage["mdprv_table_wrap"]`
  (`"1"`/`"0"`, desligada por padrão) e a classe `mdprv-wrap-cells` em
  `<html>`. O boot script aplica a classe antes do body e o salvamento alterna
  ao vivo; no CSS, só células/cabeçalhos de `.mdprv-grid` mudam (o painel de
  detalhe da lightbox continua com `pre-wrap`).
- `loader` no `config.json`/`MDPRV_LOADER` vence o preset do tema; sem escolha
  explícita, vale o `loader` do tema (`auto` escolhe pela variante clara/escura).
- A página Sistema é somente leitura; “Restaurar padrões” limpa apenas as
  preferências do modal (incluindo o cookie `mdprv_emoji` e `?emoji=`) e
  preserva largura e colunas recolhidas.

## Consequências

- O HTML inicial ficou menor: saem os placeholders `{{mdprv-theme-options}}` e
  `{{mdprv-loader-options}}`, os helpers `themeOptions`/`loaderOptions` e o
  binding do `select#mdprv-loader`.
- O modal depende de `#mdprv-data` (tema efetivo, catálogos, pacote de emojis e
  config do daemon) e reutiliza as islands reais (loader, tabela, diff) nas
  prévias.
- Rotas internas (`#/temas[/importar]`, `#/aparencia`, `#/emojis`,
  `#/widgets[/graficos|tabelas|diff]`, `#/sistema`) só existem com o modal
  aberto; o hash do documento é salvo e restaurado. `#/aparencia/tema` é aceito
  como apelido antigo e abre `#/temas`.
- Reloads forçados (SSE de tema/arquivo) preservam o modal aberto via
  `sessionStorage["mdprv_settings_open"]`; salvar com Shiki/Mermaid/tema grava
  a mesma chave para reabrir o modal na rota atual depois do reload.
