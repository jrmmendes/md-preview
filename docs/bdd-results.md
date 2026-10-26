# Resultados BDD — refatoração

Registro de execução dos cenários de `docs/bdd-scenarios.md` contra o baseline `pre-refactor`.

## Fase 0 — Baseline

- Fixture criada em `docs/fixtures/reference.md` com `docs/fixtures/img/foto.png` (16x16).
- Tag git `pre-refactor` criada no commit da fixture.
- Captura visual de baseline **não executada nesta tarefa**: será feita pelo orquestrador via MCP Playwright.
- Parâmetros acordados para a captura: viewport **1280×800**, esquemas **claro** e **escuro**.
- Capturas devem ser gravadas em `docs/baseline/<cenário>/` (ignorado pelo git via `.gitignore`).
- Diferenças intencionais e desvios de implementação serão registrados abaixo, por fase.

## Desvios

- **Smoke em portas alternativas:** a porta `8765` já estava ocupada por um `md-preview-server` externo ao repositório (`~/.config/nvim/core/custom/md-preview`). Para não interromper um processo do usuário, os smokes usaram portas isoladas (8767, 8770, 8771, 8773, 8774, 8775, 8777, 8778, 8779) com `MDPRV_STATE` em `/tmp`. Todos os daemons foram encerrados com `daemon stop`, o state foi limpo e as portas liberadas.
- Nenhum outro desvio registrado até o momento.

## Fase 1 — Extração do JS para `ui/`

- JS de browser extraído de `buildScripts` para módulos TypeScript em `src/ui/`, com `tsconfig.ui.json` separado.
- Persistência centralizada em `src/ui/prefs.ts`; `window.mdprvLoader` e `window.__mdprvSyncZen` eliminados.
- Polling de `/version` (700 ms) e `/__slugs` (4 s) mantido nesta fase, conforme o plano (SSE entra na fase 6).
- Verificações: `bun run typecheck` (dois projetos), `bun run build`, `bun run build:client` e smoke HTTP do asset/página passaram.

## Fase 2 — Extração do CSS para `ui/styles/`

- `BASE_CSS` e `SHIKI_DUAL_CSS` removidos de `src/page.ts`; CSS real em `src/ui/styles/{base,meta,sidebar,mermaid,loader}.css`, importado por `src/ui/main.ts`.
- `base.css` emite sempre as regras dual-theme do Shiki (`--shiki-light` e `--shiki-dark`), substituindo o bloco condicional.
- `dist/client/main.css` gerado e servido em `/__assets/main.css`.
- Smoke: CSS respondeu `200`, `body` com fundo do tema, `article` com `max-width` de 46rem, TOC e meta card montados; nenhum erro no console.

## Fase 3 — Shell HTML + tokens + build em dois estágios

- `src/ui/index.html` com markup integral e tokens `{{mdprv-*}}`; `src/page.ts` agora tem 94 linhas e apenas substitui tokens (`{{mdprv-body}}` por último).
- `src/shell.ts` temporário carrega `dist/client/index.html`; `src/daemon.ts` usa `renderPage(input, loadShell())`.
- Build em dois estágios: HTML autocontido (`compile: true`) gera apenas `dist/client/index.html` com JS/CSS inline; o Mermaid permanece externo e é servido por `/__assets/mermaid.min.js`.
- `--client-only` e `--dev` suportados; em `--dev` os assets saem como `chunk-<hash>.js`/`.css` e são servidos pela rota `/__assets/*`.
- Smoke: resposta sem `{{mdprv-`, `<select>` de tema/loader preenchidos no servidor, 9 temas, 6 loaders, TOC, 2 diagramas Mermaid renderizados, 2 botões de copiar e 1 módulo inline; nenhum erro no console.


## Fase 4 — `application/` + `core/` e config única

- Criados `src/core/` (`config`, `contract`, `page`, `meta`, `markdown/{render,highlight}`, `themes/index`) e `src/application/` (`cli/{index,commands,daemon-client,browser}`, `daemon/{index,routes,watch,images,assets,shell}`).
- `renderPage(input, shell)` puro em `core/`; `PageInput` com `loader`/`zoomSensitivity` já normalizados.
- `core/config.ts` é a única leitura de `process.env`; `configToEnv` alimenta o spawn do daemon. `state.ts` recebe `stateFile` explícito.
- Testes adicionados: `tests/{config,page,meta,markdown}.test.ts` — 23 testes passando.
- Smoke: `bin/md-preview` abriu a fixture em porta livre, página `200` sem `{{mdprv-`, `daemon status` e `daemon stop` funcionaram e o state json foi removido.

## Fase 5 — Temas como JSON

- Catálogo criado em `src/core/themes/catalog/` (9 arquivos) + `schema.json` (draft 2020-12, somente DX).
- `tokens.ts` valida cada tema; `css.ts` tem um único gerador (`auto` com `prefers-color-scheme`, fixo só `:root`); `mermaid.ts` deriva defaults dos tokens e aplica overrides; `resolve.ts` centraliza query → cookie → fallback.
- `ThemeDef`, `rootVars`, `mermaidDark`, `shikiLight`/`shikiDark` e o ramo condicional de Shiki foram removidos.
- Shiki passou a usar sempre `{ light, dark }`: tema fixo duplica o mesmo tema Shiki nos dois lados, preservando o CSS dual.
- `config.ts` valida `MDPRV_THEME` com `hasTheme`, caindo em `DEFAULT_THEME`.
- Testes: 42 passando, incluindo `tests/themes.test.ts` (todo o catálogo, ordem, CSS e payload Mermaid).

### Paridade Mermaid

- Para cada tema fixo, `mermaid.overrides` contém o conjunto efetivo de `themeVariables` do tema base do Mermaid 12.2.0 combinado com os overrides antigos. Assim `defaults + overrides` reproduz os valores efetivos do baseline, sem depender do novo mapa derivado dos tokens.
- `useGradient` é booleano no Mermaid, mas `overrides` só aceita strings; nos temas cujo baseline tinha `useGradient: true` ele foi gravado como `"true"` (truthy, mesmo comportamento). Temas com `false` omitem a chave, mantendo o default falso.
- Smoke: `?theme=auto`, `?theme=nord` e `?theme=dracula` sem tokens, 9 opções na ordem `auto` + alfabética, Shiki presente, 2 diagramas Mermaid renderizados, `#mdprv-data` com `mermaid.light` e `mermaid.dark`; sem erros no console.

## Fase 6 — SSE no lugar do polling

- `GET /__events` entrega `event: snapshot` na conexão, `version` em mudanças de conteúdo, `slugs` em mudanças de conjunto/título e `ping` a cada 20 s; `ping` atualiza `lastActivity`.
- Rotas `/version` e `/__slugs` removidas; nenhum `setInterval` ou `fetch` periódico em `src/ui`.
- `ui/services/events.ts` mantém uma única `EventSource` por aba e expõe `on(type, handler)` para as ilhas.
- `live-reload` adota as versões do `snapshot` sem recarregar e só recarrega em `version` posterior; `history` renderiza a lista a partir de `snapshot`/`slugs`.
- `tests/application.test.ts`: daemon em porta efêmera, snapshot, `version` após escrita, `slugs` após mudança de título, `ping`, shutdown e state limpo; segundo teste cobre heartbeat mantendo o daemon vivo e expiração do idle após desconectar. Total: 44 testes.
- Smoke HTTP: `curl -N` mostrou `snapshot` e, após `touch` na fixture, `version`; cliente desconectado não derrubou o daemon; `daemon stop` limpou o state.
- Smoke com navegador: lista de recentes via snapshot (1 item ativo), snapshot não recarregou a página, `touch` disparou reload, sem erros no console.

### Desvio de plataforma

- O `Bun.serve` fecha conexões ociosas pelo `idleTimeout` padrão (~10 s), antes do heartbeat de 20 s. O daemon define `idleTimeout: 0` para manter o SSE aberto; o idle continua sendo controlado pela aplicação (`MDPRV_IDLE` + heartbeat).

## Fase 7 — Layout `core/` fechado

- `frontmatter.ts`, `slug.ts` e `state.ts` movidos para `src/core/`; imports de `application/`, `daemon/` e testes atualizados.
- `core/state.ts` recebe `stateFile` explícito, mantém escrita atômica (`tmp` + `rename`) e não lê ambiente.
- `core/slug.ts` mantém `Bun.spawnSync(["git", ...])` como I/O local permitido.
- Raiz de `src/` agora contém apenas `application/`, `core/`, `ui/` e `types.d.ts`.
- Novos testes: `frontmatter`, `slug` e `state` com diretórios temporários e limpeza; suíte total em 59 testes.
- `README.md` atualizado com layout em camadas, scripts, `MDPRV_*`, chaves persistidas e SSE no lugar de polling.
- Smoke: página `200` sem tokens, `/__events` com `snapshot`, daemon encerrado e state removido.

## Fase 8/9 — auditorias

| Item | Resultado |
| --- | --- |
| `bun run typecheck` | ok |
| `bun test` | 59 pass / 0 fail (9 arquivos) |
| `bun run build` | ok |
| `./build.sh` | ok |
| `rg "BASE_CSS\|buildScripts" src` | vazio |
| `rg "process\.env" src` | só `src/core/config.ts` |
| `rg "setInterval" src/ui` | vazio |
| `rg "window\.mdprv\|window\.__mdprv" src/ui` | vazio |
| `rg "localStorage\|sessionStorage\|document\.cookie" src/ui` | só `src/ui/prefs.ts` |
| `rg "from .*application\|from .*ui" src/core` | vazio |
| `rg "node:\|Bun\." src/ui` | vazio |
| Hex fora de `catalog/` | 0 com `-g '!**/catalog/**'`; o glob literal `!catalog/**` não exclui o diretório aninhado e lista apenas arquivos do catálogo |
| `rg "ThemeDef\|rootVars\|mermaidDark\|shikiLight\|shikiDark" src` | vazio |
| `rg "/version\|/__slugs" src` | vazio |
| `rg "mdprv-left-collapsed\|mdprv-right-collapsed" src` | só a migração em `src/ui/prefs.ts` |
| `.gitignore` | contém `dist/`, `.plans/`, `bin/`, `docs/baseline/` |
| Cookie lido pelo daemon | apenas `mdprv_theme` |
| Preferências de UI enviadas ao daemon | nenhuma (`src/ui` sem `fetch`, `__register` ou `__shutdown`) |
| Binário único/offline | cópia em `/tmp/mdprv-bin`, sem `dist`/`node_modules`: página `200` e zero tokens `{{mdprv-`; `daemon stop` removeu o state |

- Ajuste de auditoria: as classes CSS de colapso passaram de kebab-case para `mdprv_left_collapsed`/`mdprv_right_collapsed`; as strings antigas permanecem apenas na migração de `prefs.ts`, que continua lendo as chaves legadas uma vez.
- Daemon deixado em execução para validação visual: `http://127.0.0.1:8780/docs/fixtures/reference` responde `200` (state em `/tmp/mdprv-bdd/daemon.json`). A raiz `/` responde `404` porque o slug registrado é `docs/fixtures/reference`; não existe documento no slug raiz. O processo foi reiniciado após a correção da Fase 8.

## Fase 8 — correções

- Corrigido id duplicado no shell: o `<style>` passou de `id="mdprv-theme"` para `id="mdprv-theme-css"`; o `<select id="mdprv-theme">` e o `<label for="mdprv-theme">` permaneceram. Nenhum CSS/JS referenciava o id do `<style>`.
- Adicionado `tests/shell.test.ts`, que lê `src/ui/index.html` e falha se houver qualquer `id` duplicado; também confirma que o style e o select têm ids distintos.
- Verificação no navegador: trocar o select para `nord` gravou `mdprv_theme=nord`, recarregou com `?theme=nord` e aplicou `data-theme="nord"`; `getElementById("mdprv-theme")` resolve para o `<select>`.
- **Desvio do ADR:** o ADR sugeria `<style id="mdprv-theme">`, que colidia com o select; adotado `id="mdprv-theme-css"` para o style.
- O comando de reinício usou `docs/fixtures/reference.md` (com extensão), pois naquela versão a CLI rejeitava arquivos sem `.md`/`.markdown`. Hoje `.mdc` também é aceito.
- Daemon de validação reiniciado: porta `8780`, PID `222412`, state `/tmp/mdprv-bdd/daemon.json`.

## Fase 8 — paridade validada

**Método:** worktree da tag `pre-refactor` em `/tmp/md-preview-baseline` (daemon em `8781`) comparado com a versão atual (daemon em `8780`), viewport 1280×800, mesma fixture `docs/fixtures/reference`. A comparação foi ao vivo, por estilos computados e inspeção visual das screenshots salvas em `docs/baseline/*.png` (gitignored), contra o worktree da tag — não por pixel-diff automatizado.

**Resultados**

- `auto` claro: páginas praticamente idênticas. Única diferença intencional: o bloco Shiki agora tem cores no modo claro; antes o CSS dual só emitia a regra escura.
- `auto` escuro (reload após trocar o `colorScheme`): estilos computados do Mermaid idênticos ao baseline — nó `fill rgb(31,32,32)`, texto `rgb(204,204,204)`, aresta `rgb(211,211,211)`, labels do `architecture-beta` `rgb(204,204,204)`.
- `nord`: estilos computados idênticos — node fill `rgb(59,66,82)`, texto `rgb(216,222,233)`, aresta `rgb(136,192,208)`, fundo `rgb(46,52,64)`.
- Sem erros de console; rede apenas `127.0.0.1` (documento, `/img/...`, `/__assets/mermaid.min.js`, `/__events`); nenhum CDN.
- `<select>` de tema (9 opções, `auto` + alfabético) e de loader (6) preenchidos no HTML do servidor.
- Zen alterna `html.mdprv-zen`/`aria-pressed=true` e não persiste ao recarregar.
- TOC navega, `IntersectionObserver` marca o item ativo e o back-to-top aparece (`opacity 0.85`).
- Lightbox abre com `body.mdprv-mermaid-lock`, fecha com `Esc` e restaura o foco.
- Tema: `nord` grava `mdprv_theme=nord`, recarrega com `?theme=nord`, aplica `data-theme="nord"` e `--mdprv-bg #2e3440`; voltar para `auto` limpa o query e o CSS volta a ter `prefers-color-scheme: dark`.

**Diferenças intencionais**

- Ordem do `<select>` de tema: agora `auto` + alfabética.
- Shiki no esquema claro: passou a emitir também `--shiki-light`, corrigindo a ausência da regra clara no baseline.

**Limitação:** a captura de baseline não existia antes da migração; por isso a comparação foi feita ao vivo contra o worktree da tag, com inspeção visual e estilos computados, não por diff automatizado de pixels.

### Desvio de payload

O JSON `#mdprv-data` tem ~19 KB porque os `overrides` do Mermaid carregam o conjunto efetivo de `themeVariables` de cada tema, garantindo paridade exata com o Mermaid 12.2.0 do baseline sem depender do novo mapa derivado dos tokens. A página final fica em ~98 KB. A escolha privilegia paridade e previsibilidade; uma otimização futura possível é reduzir os overrides às chaves que realmente divergem do mapa derivado, revalidando os temas contra o baseline.
