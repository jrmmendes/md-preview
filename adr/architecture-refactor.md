# ADR-0001 — Reorganização em `application/`, `core/` e `ui/`

- **Status:** Proposto
- **Data:** 2026-10-20
- **Escopo:** `src` (pacote `md-preview`, Bun 1.4.3)
- **Substitui:** organização plana atual (`src/*.ts` + strings de HTML/CSS/JS em `page.ts`)
- **Verificações de plataforma:** executadas em Bun 1.4.3 (ver *Pipeline de build*)
- **Relacionado:** `docs/bdd-scenarios.md` (cenários de paridade visual e comportamental)

## Contexto

O projeto é uma CLI + daemon local empacotados em um único binário (`bun build --compile`, `build.ts:5-11`). O daemon serve HTML por requisição (`src/daemon.ts:244`) e o mesmo executável é reexecutado com o subcomando oculto `__serve` (decisão registrada em `.plans/2026-10-20-1416-cli-autonoma-md-preview-bun-typescript.md`).

Sintomas atuais:

1. **Apresentação em template strings.** `src/page.ts` tem 1001 linhas e três monólitos: `BASE_CSS` (`104-241`), `buildScripts` (`249-915`, ~660 linhas de JS) e a montagem (`941-1000`).
2. **JS de browser não é typechecked.** `buildScripts` devolve uma string; `tsconfig.json` inclui `src`, mas string não é código. Erros só aparecem no console do navegador.
3. **Persistência duplicada.** O par localStorage→cookie→default aparece seis vezes (`page.ts:276-288`, `356-366`, `465-473`, `699-711`, `752-760`, `849-857`).
4. **Configuração dispersa.** `MDPRV_PORT` é lido em três arquivos (`daemon.ts:43`, `client.ts:16`, `cli.ts:65`), com `8765` duplicado (`daemon.ts:11`, `client.ts:10`, `cli.ts:65`); `MDPRV_IDLE/THEME/LOADER/ZOOM_SENSITIVITY` são lidos em escopo de módulo (`daemon.ts:43-47`), o que impede testar o daemon e cria efeito colateral no import.
5. **Ambiguidade de nome.** `src/client.ts` é o *cliente do daemon* (CLI, `fetch`/spawn), não código de navegador — enquanto "client" no resto do ecossistema significa browser.
6. **Escapes manuais.** CSS dentro de TS exige `\\25B8`, `\\s`, `\\.`, e o escaper de HTML é reimplementado duas vezes (`page.ts:29-35`, `render.ts:44-50`).
7. **Modelo de tema com três formas.** `ThemeDef` (`themes.ts:18-29`) aceita `kind: auto` + `light`/`dark`, tema fixo + `vars`, e Shiki em `shiki` **ou** `shikiLight`/`shikiDark`; cada consumidor precisa ramificar (`page.ts:91-102`, `render.ts:81-83`, `page.ts:249-254`). `auto` duplica os objetos de `github-light`/`github-dark` (`themes.ts:31-61`), e as cores do Mermaid são redigitadas à mão dentro de cada tema (`themes.ts:89-106` e seguintes), abrindo espaço para divergência entre página e diagrama.

Restrições que a solução **não pode** violar:

- binário único, sem arquivos externos em runtime;
- página server-rendered: HTML completo e estilizado na primeira resposta, legível sem JS;
- funcionamento offline / localhost, sem CDN e sem bundler externo;
- `MDPRV_*` continua sendo a superfície de configuração (flags de CLI como `--port`/`--theme` seguem fora de escopo, conforme o plano);
- `assets.ts` continua embutindo o mermaid via `with { type: "file" }` (`src/assets.ts:1`).

## Decisão

Adotar três camadas com dependência **unidirecional** — `application` (host), `core` (microkernel de libs) e `ui` (presentation) — e um pipeline de build em dois estágios que preserva o binário único.

```
┌───────────────────────────────────────────────┐
│ application/                                  │
│   cli/       argv, comandos, spawn, exit      │
│   daemon/    Bun.serve, SSE, watch, assets    │
└───────┬───────────────────────────┬───────────┘
        │ importa                    │ injeta shell
┌───────▼───────────┐       ┌───────▼───────────┐
│ core/             │       │ ui/               │
│ microkernel: libs │       │ presentation      │
└───────────────────┘       └───────────────────┘
```

### Regras de dependência

| Camada | Pode importar | Proibido |
| --- | --- | --- |
| `application/` | `core/`, o **asset** `ui/index.html`, `node:*`, `Bun.*` | regra de negócio duplicada de `core/` |
| `core/` | `core/`; I/O local (`fs`, `env`) dentro da própria lib | `application/`, módulos de `ui/`, `Response`/`Bun.serve`, APIs de DOM |
| `ui/` | `ui/`, `import type` de `core/` | runtime de `core/`/`application/`, `node:*`, `Bun.*` de servidor |

`core/` é o **microkernel**: bibliotecas reutilizáveis, sem apresentação nem transporte. Ele não lê `ui/` — o shell HTML entra por parâmetro em `renderPage(input, shell)`, e a `application` é quem carrega o asset.

`ui/` só é ligado ao servidor por **dados**, não por código: `data-*` no `<html>` e um bloco `<script type="application/json">`.

### Layout proposto

```
src/
  application/
    cli/
      index.ts          # commander, parseAsync, exit codes  (de src/cli.ts)
      commands/
        preview.ts      # <file>
        daemon.ts       # start | stop | status
        serve.ts        # __serve (oculto)
      daemon-client.ts  # ensureDaemon/register/shutdown   (de src/client.ts)
      browser.ts        # openInBrowser
    daemon/
      index.ts          # startDaemon(config)
      routes.ts         # handle(req) -> Response, inclui GET /__events (SSE)
      watch.ts          # fs.watch + version
      images.ts         # serveImage
      assets.ts         # transporte: /__assets/mermaid.min.js (de core/assets.ts)
      shell.ts          # carrega dist/client/index.html e injeta em core/page
  core/
    config.ts           # ÚNICA leitura de env + defaults + validação
    contract.ts         # tipos do contrato ui↔core (data-* e JSON)
    page.ts             # renderPage(input, shell) — sem I/O de asset
    meta.ts             # cartão de metadados (puro)
    markdown/
      render.ts         # markdown-it + Shiki
      highlight.ts
    themes/
      schema.json       # JSON Schema dos arquivos de tema (DX de editor)
      catalog/
        auto.json       # kind: auto -> referencia light/dark
        dracula.json
        github-light.json
        ...
      tokens.ts         # tipos + guard + resolução
      css.ts            # tokens -> custom properties (um só caminho)
      mermaid.ts        # tokens -> themeVariables (+ overrides)
      resolve.ts        # resolveThemeName
    frontmatter.ts
    slug.ts
    state.ts            # persistência local (recebe config.stateFile)
  ui/
    index.html          # shell com tokens {{mdprv-*}}
    main.ts             # bootstrap + islands
    prefs.ts            # ÚNICO ponto de persistência (cookie/local/session)
    services/
      loader.ts         # singleton tipado (substitui window.mdprvLoader)
    islands/
      layout.ts         # drag de largura, collapse sidebars, zen, top
      loader-overlay.ts # overlay + tempo mínimo de exibição
      toc.ts
      history.ts        # recebe a lista por SSE
      settings.ts       # tema, fonte, loader, zoom
      mermaid-lightbox.ts
      copy-code.ts
      live-reload.ts    # EventSource /__events
    styles/
      base.css
      meta.css
      sidebar.css
      mermaid.css
      loader.css
dist/client/index.html  # gerado (ver build)
```

### Pipeline de build (dois estágios)

O `Bun.build` desta versão aceita **HTML como entrypoint** e, com `target: "browser"` + `compile: true`, emite **HTML autocontido** com `<script>`/`<style>` inline e assets em `data:` URI (`bun-types/bun.d.ts:3699-3735`). É exatamente o formato que `renderPage` produz hoje, mas escrito em arquivos reais.

```ts
// 1) ui: HTML entrypoint → um único index.html autocontido
await Bun.build({
  entrypoints: ["src/ui/index.html"],
  target: "browser",
  compile: true,                     // inline de JS/CSS; sem splitting
  minify: true,
  outdir: "dist/client",
  external: ["*/mermaid.min.js"],    // glob: caminho exato NÃO funciona
});

// 2) cli: binário único, com o HTML compilado embutido
await Bun.build({
  entrypoints: ["src/application/cli/index.ts"],
  target: "bun",
  minify: true,
  compile: { outfile: "bin/md-preview" },
});
```

`application/daemon/shell.ts` lê o **artefato** (não o fonte) e entrega o HTML ao `core`:

```ts
import shellPath from "../../../dist/client/index.html" with { type: "file" };
export function loadShell(): string {
  return readFileSync(shellPath, "utf8"); // dev: relê; produção: cacheia
}
```

Regras do estágio 1 (todas verificadas em Bun 1.4.3):

- **Ordem obrigatória:** estágio 1 antes do 2. `build.ts` e `build.sh` passam a orquestrar os dois.
- `compile: true` gera **um** `dist/client/index.html`, com `<style>` e `<script type="module">` inline. Não há splitting.
- **`<script src>` é resolvido pelo bundler**, inclusive caminho absoluto: `/__assets/mermaid.min.js` falha com "Could not resolve". O mermaid fica externo via `external: ["*/mermaid.min.js"]` — o caminho exato não casa, só o glob.
- **Dev sem `compile`** emite `index-<hash>.js`/`.css` com URLs relativas, que resolveriam para `/index-<hash>.js` quando a página é servida em `/slug`. Corrige-se com `--public-path /__assets/` + a rota `/__assets/*` (`daemon.ts:319`).
- **Dev roda do fonte** (`bun src/application/cli/index.ts`), e `loadShell()` relê `dist/client/index.html` a cada request; em produção o valor é cacheado no primeiro uso. Sem isso, o `--watch` do cliente não aparece no binário em execução.
- `import "*.html" with { type: "file" }` funciona no `--compile`; tanto `readFileSync` quanto `Bun.file` leem o asset embutido (`/$bunfs/...`).
- `src/types.d.ts` ganha `declare module "*.html"` (hoje só existe `*.js`), senão o `import` do shell não compila.
- Comentários HTML e tokens `{{...}}` sobrevivem ao minify, mas o shell adota **tokens** (`{{mdprv-body}}`): se um não for substituído, aparece na página em vez de sumir silenciosamente.

### Contrato `ui` ↔ `core`

`renderPage` deixa de montar 700 linhas e passa a preencher tokens. Ele recebe o shell por parâmetro — `core/page.ts` não toca em `fs` nem conhece `ui/` — e `PageInput` chega com valores **já normalizados** (`loader: LoaderName`, `zoomSensitivity: number`) por `core/config.ts`, sem revalidação:

```ts
export interface PageInput {
  title: string;
  body: string;          // HTML confiável do renderer
  themeName: string;
  loader: LoaderName;
  zoomSensitivity: number;
  meta?: Record<string, unknown>;
}

export function renderPage(input: PageInput, shell: string): string {
  const theme = getTheme(input.themeName);
  const mermaid = mermaidPayload(theme); // { light, dark }; fixo duplica os dois
  const fill: Array<[string, string]> = [
    ["{{mdprv-title}}", Bun.escapeHTML(input.title)],
    ["{{mdprv-theme}}", theme.name],
    ["{{mdprv-theme-options}}", themeOptions(theme.name)],     // <select> server-rendered
    ["{{mdprv-loader}}", input.loader],
    ["{{mdprv-loader-options}}", loaderOptions(input.loader)], // <select> server-rendered
    ["{{mdprv-zoom}}", String(input.zoomSensitivity)],
    ["{{mdprv-theme-css}}", themeCss(theme)],       // ~200 bytes por request
    ["{{mdprv-meta}}", renderMeta(input.meta)],
    ["{{mdprv-data}}", jsonForScript({ mermaid })]  // {mermaid:{light,dark}}
  ];
  let out = fill.reduce((acc, [k, v]) => acc.replace(k, () => v), shell);
  return out.replace("{{mdprv-body}}", () => input.body); // body por último
}
```

- As opções de tema (`themeNames()`) e de loader (`LOADERS`) são geradas no servidor: `<select>` já vem preenchido, sem JS e sem depender de runtime de `core` no browser.
- `{{mdprv-theme-css}}` vive num `<style id="mdprv-theme">` dedicado no shell, fora do CSS empacotado.
- `{{mdprv-data}}` é o JSON de configuração (Mermaid claro/escuro); vai num `<script type="application/json" id="mdprv-data">`, serializado por `jsonForScript()`, que escapa `<` como `\u003c` (mesmo em JSON, `</script>` quebraria o bloco). O `textContent` serve só para leitura.
- O shell vem de `application/daemon/shell.ts`; `core/page.ts` é puro e testável com um shell fixture.
- `{{mdprv-body}}` é substituído **por último**, para que tokens dentro do Markdown não sejam interpretados.
- `Bun.escapeHTML` substitui os escapers manuais e também escapa `'` (`bun-types/bun.d.ts:2405-2423`).
- `themeCss` permanece no servidor porque o Shiki é renderizado para o tema ativo (`render.ts:81-96`); troca de tema continua recarregando.

### Configuração

Uma única porta de entrada, em `core/config.ts`:

```ts
export interface Config {
  port: number;          // MDPRV_PORT, default 8765
  idleMs: number;        // MDPRV_IDLE (min), default 15
  stateFile: string;     // MDPRV_STATE | XDG_STATE_HOME
  theme: string;         // MDPRV_THEME, default "auto"
  loader: LoaderName;    // MDPRV_LOADER, default "classic"
  zoomSensitivity: number; // MDPRV_ZOOM_SENSITIVITY, default 1.1
}
export function loadConfig(env = process.env): Config;
```

- `DEFAULT_PORT`/`DEFAULT_IDLE` existem **só** aqui; `cli.ts:65` deixa de redigitar `8765` e `client.ts:10` deixa de duplicar `DEFAULT_PORT`.
- `resolveLoaderName`/`resolveZoomSensitivity` saem de `page.ts:15-27` para cá; `daemon.ts:47` deixa de usar `Number(...) || 1.1`.
- `core/state.ts` deixa de ler env (`state.ts:11-14`): passa a receber `config.stateFile`; o cálculo de `MDPRV_STATE`/`XDG_STATE_HOME` fica só em `config.ts`.
- `PageInput` recebe `loader`/`zoomSensitivity` já normalizados (ver *Contrato*), logo `page.ts` não importa os resolvers.
- `application/daemon/index.ts` expõe `startDaemon(config: Config)`, substituindo a leitura de env em escopo de módulo (`daemon.ts:43-47`).
- `application/cli/daemon-client.ts` encaminha a config no spawn (`client.ts:62`) de forma explícita.
- Nenhuma flag nova. Se um dia entrarem `--port`/`--theme`, elas alimentam o mesmo `Config` em `application/cli/commands/*`.

A precedência entre daemon, sessão e browser e o ciclo de vida de cada estado estão em **Gerenciamento de estado**, em uma tabela única (para não duplicar a regra aqui).

### Temas por tokens JSON

Tema é **dado**, não código: um arquivo JSON por tema em `core/themes/catalog/`. Adicionar ou ajustar um tema não exige tocar em TypeScript.

**Vocabulário canônico.** Sete tokens, e a chave JSON é exatamente o sufixo da custom property:

| Token | Custom property |
| --- | --- |
| `bg` | `--mdprv-bg` |
| `fg` | `--mdprv-fg` |
| `muted` | `--mdprv-muted` |
| `link` | `--mdprv-link` |
| `border` | `--mdprv-border` |
| `code-bg` | `--mdprv-code-bg` |
| `quote` | `--mdprv-quote` |

Isso elimina `rootVars` (`page.ts:79-89`): o CSS é gerado iterando as chaves, sem lista manual para manter em sincronia.

**Tema fixo** (`nord.json` — só um `override`, porque o resto é derivado):

```json
{
  "$schema": "../schema.json",
  "name": "nord",
  "kind": "dark",
  "tokens": {
    "bg": "#2e3440", "fg": "#d8dee9", "muted": "#7b88a1",
    "link": "#88c0d0", "border": "#4c566a",
    "code-bg": "#3b4252", "quote": "#7b88a1"
  },
  "shiki": { "light": "nord", "dark": "nord" },
  "mermaid": { "theme": "neutral", "overrides": { "secondaryColor": "#4c566a" } }
}
```

**Tema automático** (`auto.json`) não duplica tokens, apenas referencia dois temas:

```json
{
  "$schema": "../schema.json",
  "name": "auto",
  "kind": "auto",
  "variants": { "light": "github-light", "dark": "github-dark" }
}
```

**Regras de validação.** A fonte de verdade é o **guard** `validateTheme()`; `schema.json` (draft 2020-12, `additionalProperties: false`) espelha o mesmo formato apenas para o editor:

- `name` deve ser igual ao nome do arquivo (verificado em teste).
- `kind: "auto"` exige `variants` e proíbe `tokens`/`shiki`/`mermaid`.
- `kind: "light"|"dark"` exige os sete tokens e `shiki.light`/`shiki.dark` (mesmo valor quando o tema é fixo).
- Cores apenas `#rrggbb`.
- `overrides` do Mermaid restrito a `Record<string,string>`.

**Derivações — um caminho só para auto e fixo:**

- **CSS**: `themeCss()` sempre emite `:root{<conjunto claro>}` e, quando `kind: "auto"`, `@media (prefers-color-scheme: dark){:root{<conjunto escuro>}}`. Tema fixo usa o mesmo conjunto nos dois lados, então some o ramo triplo de `page.ts:91-102`.
- **Shiki**: todos os temas usam `{ themes: { light, dark }, defaultColor: false }`; o ramo `theme.shiki ? … : { light, dark }` de `render.ts:81-83` deixa de existir. O CSS dual (`page.ts:243`) passa a emitir as **duas** regras (`--shiki-light` e `--shiki-dark`) em vez de só a escura, e é sempre incluído.
- **Mermaid**: `themeVariables` é derivado dos tokens por um mapa default (`background←bg`, `primaryColor/mainBkg←code-bg`, `primaryTextColor/textColor/titleColor←fg`, `lineColor/nodeBorder/primaryBorderColor←link`, `clusterBorder←border`, `secondaryColor←muted`, `tertiaryColor/clusterBkg/edgeLabelBackground←bg`), e o `themeVariables` efetivo é `defaults + overrides`. Temas com divergência (ex.: `dracula`) declaram só o que muda, de modo que os JSONs reproduzem **exatamente** as cores atuais. Em **tema fixo**, `mermaid.light` e `mermaid.dark` são o mesmo objeto; em `auto`, vêm dos dois variantes. Assim o cliente pode escolher sempre por `prefers-color-scheme`, sem o booleano `auto`. Isso apaga as cópias de literais em `themes.ts:89-106` e seguintes.
- **Payload ao cliente**: sempre `{ mermaid: { light, dark } }`; desaparecem o booleano `auto` e o `mermaidDark` anulável (`page.ts:249-254`, `321-327`).

**Carregamento e validação.** Os JSON são importados estaticamente (`resolveJsonModule` já está ativo), portanto entram no binário e não há leitura de FS em runtime. `tokens.ts` exporta tipos, `validateTheme()` (guardas, sem dependência nova) e `loadThemes()`, que resolve `auto` → variantes e falha cedo em dado inválido. `bun test` percorre todo `catalog/*.json` e chama o guard (nome, chaves, formato de cor, referências de `variants` e nomes de tema Shiki). O `schema.json` **não** é lido em runtime nem no teste: existe para autocomplete e documentação no editor.

**Ordem de exibição.** `auto` primeiro, os demais em ordem alfabética (sem campo extra no JSON).

**O que desaparece:** as três formas de `ThemeDef`, a duplicação de `githubLight`/`githubDark` dentro de `auto`, o `rootVars` manual, os três ramos de `themeCss`, o `SHIKI_DUAL_CSS` condicional e as cores de Mermaid redigitadas por tema.

### Frontend

- CSS em arquivos reais, divididos por feature (`base`, `meta`, `sidebar`, `mermaid`, `loader`). Fim dos escapes dentro de TS.
- JS em módulos `.ts` tipados; cada ilha monta-se a partir de um elemento existente (`article`, `pre.mermaid`, `#mdprv-history-list`), sem re-renderizar o artigo.
- `ui/prefs.ts` é o único ponto de persistência (cookie, localStorage, sessionStorage); as seis cópias atuais viram uma e cada chave tem uma linha em *Gerenciamento de estado*.
- Sem biblioteca de UI: as ilhas são módulos `.ts` que montam sobre o DOM já renderizado (listeners + manipulação direta). O artigo, o TOC e os controles vêm prontos do servidor; o cliente só adiciona comportamento.
- `Bun.markdown` **não** faz parte desta decisão: não processa footnotes (verificado em Bun 1.4.3 — `[^1]` fica literal), usadas em `render.ts:3,78`. Fica como experimento separado.

### Gerenciamento de estado

Cinco escopos, escolhidos por uma pergunta de decisão:

1. É estado do daemon e precisa sobreviver ao processo? → disco, `core/state.ts`.
2. O servidor precisa ler a cada request? → **cookie**.
3. Só o navegador lê e deve sobreviver a reload? → **localStorage**.
4. Sobrevive a reload, mas não ao fechamento da aba? → **sessionStorage**.
5. Caso contrário → **memória do módulo** (a ilha é dona).

**Inventário**

| Estado | Escopo | Dono | Inicialização | Persistência |
| --- | --- | --- | --- | --- |
| `pid`/`port` do daemon | disco | `core/state.ts` | leitura no start | `daemon.json` (escrita atômica) |
| `slugs`, `version`, watchers | processo do daemon | `application/daemon/` | registro/`fs.watch` | memória |
| `Config` | processo, imutável | `core/config.ts` | env no start | — |
| tema da request | request | `core/themes/resolve.ts` | `?theme=` → cookie → `Config.theme` | cookie `mdprv_theme` |
| snapshot inicial do documento | documento | `core/page.ts` | `Config` + request | `data-*` + JSON (imutável) |
| preferências do usuário | browser persistente | `ui/prefs.ts` | localStorage → `data-*` | tabela abaixo |
| estado efêmero de ilha | memória do módulo | `ui/islands/*` | DOM/default | — |
| reload pendente do loader | sessão | `ui/prefs.ts` | `sessionStorage` | `mdprv_loader_pending` |
| `version` (live reload) | processo + cliente | `application/daemon/watch.ts`, `ui/islands/live-reload.ts` | `EventSource` em `/__events` | — |
| clientes SSE | processo | `application/daemon/routes.ts` | conexão aberta | — |

**Preferências persistidas** (`ui/prefs.ts` é o único que toca em storage do navegador):

| Chave | Storage | Servidor lê? | Default |
| --- | --- | --- | --- |
| `mdprv_theme` | cookie (`SameSite=Lax`, 1 ano) | **sim** | `Config.theme` |
| `mdprv_width` | localStorage | não | `--mdprv-content-width` (46rem) |
| `mdprv_loader` | localStorage | não | `Config.loader` |
| `mdprv_font` | localStorage | não | stack do CSS |
| `mdprv_zoom_sensitivity` | localStorage | não | `Config.zoomSensitivity` |
| `mdprv_left_collapsed`, `mdprv_right_collapsed` | localStorage | não | expandido |
| `mdprv_loader_pending` | sessionStorage | não | ausente |

Decisões decorrentes:

- **Só o tema usa cookie.** Largura, loader, fonte, zoom e colapso são gravados hoje em localStorage *e* cookie (`page.ts:271-275`, `481-484`, `708-711`, `766-770`, `865-866`), mas o daemon só lê `mdprv_theme` (`daemon.ts:234-238`). Os cookies não-tema saem: menos bytes em cada request e uma regra só. Se `localStorage` estiver bloqueado, `prefs.ts` cai em memória (sem persistência), sem reintroduzir cookie.
- **Zen é efêmero por decisão.** Hoje o colapso persiste (`page.ts:708-725`) e o zen não (`823-843`); isso deixa de ser acidente: zen é modo de leitura temporário e recarregar restaura a visão completa. O mesmo vale para o painel de settings aberto e para a lightbox.
- **Estado derivado não é armazenado.** TOC ativo (`IntersectionObserver`), visibilidade do "voltar ao topo" e feedback de "copiado" são calculados/temporários, não preferências.
- **Nomenclatura única.** Toda chave persistida usa `mdprv_` + `snake_case` (corrige `mdprv-left-collapsed`); a migração lê a chave antiga uma vez e regrava.

**Fonte da verdade e barramento**

- Servidor → documento: snapshot imutável em `data-*` + JSON; a ilha lê uma vez na montagem e passa a ser dona do estado efêmero.
- Ilha → persistência: apenas via `ui/prefs.ts`. Nenhuma ilha escreve estado de UI no servidor.
- Cliente → servidor: só HTTP (cookie de tema). O daemon não guarda estado de interface.
- **Proibido global de janela.** Os casos atuais `window.mdprvLoader` (`page.ts:510`) e `window.__mdprvSyncZen` (`page.ts:828`, `842`) desaparecem: serviço compartilhado é um singleton de módulo tipado em `ui/services/` (ex.: `loader`), e `layout.ts` absorve teclado + botão de zen, eliminando a sincronização global.
- `CustomEvent` (`mdprv:*`) só quando o emissor não deve conhecer o receptor; dependência explícita (`import`) tem prioridade.

**Tempo real (SSE).** Não há polling: `GET /__events` mantém uma conexão por aba e envia:

| Evento | Quando | Conteúdo |
| --- | --- | --- |
| `snapshot` | ao conectar (e ao reconectar) | `{ versions: Record<string, number>, slugs: [{ slug, path, title }] }` |
| `version` | `fs.watch` detecta mudança | `{ slug, version: number }` |
| `slugs` | o conjunto de documentos muda | `[{ slug, path, title }]` |
| `ping` | a cada 20s | heartbeat |

- O cliente usa `EventSource` (`ui/islands/live-reload.ts` e `history.ts`), que reconecta sozinho. O `snapshot` **adota** a versão atual do slug sem recarregar; só um `version` posterior dispara reload — sem isso, a primeira mensagem causaria loop.
- O `ping` renova `lastActivity` no daemon. Sem isso, o idle (`MDPRV_IDLE`, 15 min) encerraria o daemon com a aba aberta; a falha de escrita remove o cliente morto.
- `application/daemon/routes.ts` implementa o stream. `/version` e `/__slugs` são substituídos pelo `snapshot` e pelos eventos.
- Cada aba mantém uma conexão; o daemon remove o cliente quando o stream é cancelado.

**Preferência vs. comando.** O transporte segue o tipo do dado, não a conveniência:

| Dado | Transporte | Exemplo |
| --- | --- | --- |
| o servidor lê para renderizar | **cookie** | `mdprv_theme` |
| comando que muda estado do daemon | **`POST`/`PUT`** | `PUT /__register`, `POST /__shutdown` |
| evento do servidor para o cliente | **SSE** | versões, lista de slugs |
| preferência que só o navegador lê | **localStorage** | largura, loader, fonte, zoom |

Substituir o cookie do tema por um `POST /__theme` foi considerado e **rejeitado** (motivos em *Alternativas consideradas*).

### Invariantes (não regredir)

1. Primeira resposta contém HTML completo, CSS inline e o conteúdo renderizado (sem FOUC, sem fetch de conteúdo).
2. Leitura funciona sem JS; ilhas são aprimoramento.
3. Um único artefato distribuível (`bin/md-preview`).
4. Zero dependência de rede além do próprio daemon.
5. `core/` testável com `bun test` sem browser e sem env global.
6. Temas são dados: adicionar ou ajustar um tema exige apenas um novo JSON, nunca mudança de código.
7. Sem polling: atualizações em tempo real só por SSE.
8. `core/` não importa `application/` nem `ui/`; o shell entra por parâmetro.
9. Nenhum estado de UI no servidor e nenhum global de janela entre ilhas.
10. Com uma aba aberta, o daemon não encerra por idle: o heartbeat conta como atividade.

## Alternativas consideradas

| Alternativa | Motivo da rejeição |
| --- | --- |
| Manter strings e só extrair helpers | Não resolve typecheck, CSS escapado nem a montagem de 1000 linhas |
| SPA com `Bun.serve({ routes, development: true })` + `HTMLBundle` | Perde SSR e funcionamento sem JS; o conteúdo é dinâmico por slug e `HTMLBundle` é estático (`serve.d.ts:635`) |
| Bundler externo (Vite/esbuild) | Duplica o que `Bun.build` já faz; adiciona etapa e dependências |
| Biblioteca de UI com hidratação no cliente | Reescreve glue que é menor em DOM direto e adiciona runtime/hidratação sem ganho de paint |
| `Bun.markdown` agora | Perde footnotes e `typographer`/`linkify` equivalentes; troca de baixo retorno neste momento |
| Tokens em YAML/TOML | Exigiria parser e dependência; JSON é nativo no Bun, no `tsconfig` e no editor |
| Tokens direto em CSS (`[data-theme]`) | O tema precisa ser conhecido no servidor para escolher Shiki e Mermaid, e o catálogo alimenta o `<select>`; CSS puro não cobre as três saídas |
| `POST` interno para preferência de tema | Escopo global no daemon, corrida com o reload e perda do "abre sem JS"; o cookie entrega o valor na própria request de render |
| `ajv` para validar os temas contra `schema.json` | +1 dependência para 7 chaves; o guard cobre o caso e o schema fica no editor |
| Polling de `/version` e `/__slugs` | Dois timers por aba, latência fixa e requisições vazias; SSE entrega o mesmo com uma conexão e reconexão nativa |
| Contar streams abertos para o idle | O heartbeat já mantém a conexão viva e detecta cliente morto; um contador não percebe aba fechada abruptamente |
| Playwright como devDependency | A validação é pontual e guiada por cenários BDD (`docs/bdd-scenarios.md`); o MCP cobre antes/depois sem suíte permanente |

**POST interno para o tema (rejeitado).** A hipótese era: a troca de tema faz `POST /__theme`, o daemon guarda o valor e o cliente recarrega. Rejeitada por:

- **Escopo:** o daemon é um processo único para todos os clientes; o cookie é por navegador. Um POST global faria a última aba/navegador vencer a escolha das outras.
- **Ciclo de vida:** o daemon expira por idle (`MDPRV_IDLE`, 15 min por padrão); tema em memória morre junto. Em `daemon.json`, vira configuração global e se mistura com `{pid, port}`.
- **Timing:** o servidor precisa do tema **antes** de renderizar (Shiki, `render.ts:81-96`). O cookie chega na própria request; o POST exige escrita concluída antes do reload, abrindo uma corrida.
- **Sem JS:** o fluxo POST + reload depende de JS já ter rodado; o cookie preserva "abre e lê".
- **Custo/benefício:** economiza ~30 bytes de header e adiciona um endpoint de escrita.
- **Superfície:** qualquer página aberta no navegador pode disparar um POST simples para `127.0.0.1` (CORS bloqueia a leitura, não o envio). Os comandos existentes (`PUT /__register`, `POST /__shutdown`) justificam essa superfície; uma preferência não.

Seria a escolha certa em dois cenários: configuração **compartilhada entre clientes** (destino `daemon.json`, por decisão de produto) ou se o tema deixasse de ser renderizado no servidor (aí não haveria cookie nem POST — só CSS no cliente).

## Consequências

**Positivas**

- `page.ts` cai de 1001 para ~90 linhas; `BASE_CSS` e `buildScripts` desaparecem.
- JS de browser passa a ser typechecked (`Bun.build({ check: true })` ou `tsc`).
- Uma única fonte de config e de defaults; daemon testável.
- CSS/HTML com ferramental normal (formatter, highlight, `@media`).
- Fim da ambiguidade `client.ts` (CLI) vs browser (`ui/`).
- Tema vira arquivo: um JSON por tema, validado, sem literais de cor espalhados no TS.
- Camadas `application`/`core`/`ui`: I/O concentrado no host e libs de `core` testáveis sem browser.
- SSE substitui dois timers por aba, sem requisições vazias.
- Paridade antes/depois guiada por cenários BDD (`docs/bdd-scenarios.md`) executáveis via MCP.
- Teste de integração mínimo garante o contrato do host (SSE, broadcast e encerramento).
- Repositório achatado: `adr/`, `docs/`, `src/` e o build no mesmo nível.

**Negativas**

- Duas etapas de build e um diretório gerado (`dist/client`).
- Novo contrato (`data-*` + JSON) a manter sincronizado com `core/page.ts`.
- Mais arquivos; navegação exige conhecer as três camadas.
- Uma conexão SSE por aba; `application/daemon/routes.ts` precisa de heartbeat e reconexão.
- SSE é unidirecional — suficiente aqui; comandos continuam em `POST`/`PUT`.
- Nove JSONs curtos substituem um arquivo TS; quem adiciona tema precisa entender o schema (mitigado pelo `$schema` no editor).
- `schema.json` pode divergir do guard; mudança de token exige atualizar os dois (o teste pega o guard, não o schema).

**Neutras**

- Tamanho do HTML praticamente igual (o inline gerado é equivalente ao atual).
- Tema continua exigindo reload (limitação do Shiki server-side, não da arquitetura).
- A ordem do `<select>` muda: hoje é `auto, github-light, github-dark, dracula, nord, …`; passa a ser `auto` + alfabética (`auto, dracula, github-dark, github-light, gruvbox-dark, …`).

## Migração incremental

Cada passo é independente e shippável:

0. **Criar a tag de baseline** (ex.: `pre-refactor`) e capturar os cenários de `docs/bdd-scenarios.md` na versão atual, via MCP (screenshots, snapshot de acessibilidade e comportamento). Sem isso não existe "antes vs. depois".
1. **Extrair o JS** de `buildScripts` para `ui/main.ts` + `ui/islands/*`, servido como asset separado; markup e CSS intocados. No mesmo passo: criar `tsconfig.ui.json` (DOM), centralizar a persistência em `ui/prefs.ts` e trocar `window.mdprvLoader`/`window.__mdprvSyncZen` por singleton de módulo.
2. **Extrair o CSS** de `BASE_CSS` para `ui/styles/*.css` importados por `ui/main.ts`.
3. **Trocar a montagem** por `ui/index.html` + tokens `{{mdprv-*}}`; apagar `BASE_CSS`/`buildScripts`; atualizar `build.ts`/`build.sh` (cliente antes do servidor) e ativar o build de dois estágios.
4. **Criar a camada `application`**: mover `cli`/`daemon`; criar `application/daemon/{shell,assets}.ts`; `renderPage(input, shell)`; `core/config.ts` consumido pela `application`.
5. **Migrar temas** para `core/themes/catalog/*.json` + `schema.json`; trocar `ThemeDef` por `tokens.ts`/`css.ts`/`mermaid.ts`; remover as cópias de `auto` e os literais de Mermaid.
6. **Substituir polling por SSE**: criar `GET /__events` em `application/daemon/routes.ts` e trocar os pollers de `live-reload`/`history` por `EventSource`.
7. **Fechar o layout**: mover as libs restantes para `core/` (sem `daemon/`), ajustar imports e verificar as regras de dependência.
8. **Validar**: reexecutar os cenários BDD via MCP contra o baseline da tag, com o teste de integração da `application` verde.

> Já aplicados fora da migração: achatamento de `server/` na raiz, `.gitignore` (`dist/`, `.plans/`) e localização de `adr/` e `docs/`.

## Validação antes/depois

- Cenários em **`docs/bdd-scenarios.md`** (Gherkin), cobrindo a matriz de paridade.
- Baseline ancorado por **tag** (ex.: `pre-refactor`), capturado com o **MCP do Playwright antes** da migração (screenshot, snapshot de acessibilidade, comportamento) e reexecutado depois.
- Sem `playwright` no `package.json`: o MCP é o executor. Transformar em suíte permanente é outra decisão.

## Critérios de aceite

- [ ] `bun run typecheck` roda dois projetos: `tsconfig.json` (`application/`, `core/`) e `tsconfig.ui.json` (`ui/`, `lib: DOM`, sem `types: ["bun"]`).
- [ ] `build.ts`/`build.sh` executam o estágio do cliente antes do `--compile` do servidor.
- [ ] Em dev, `dist/client` é servido em `/__assets/*` com `publicPath: "/__assets/"`.
- [ ] `bin/md-preview` continua sendo um arquivo único e funciona offline.
- [ ] Nenhum `process.env` fora de `core/config.ts`.
- [ ] `rg "BASE_CSS|buildScripts"` não retorna nada.
- [ ] `core/` não importa `application/` nem `ui/`; `renderPage(input, shell)` recebe o shell.
- [ ] Nenhum polling em `src/ui` (`rg "setInterval" src/ui` vazio); tempo real só por `EventSource` em `/__events`.
- [ ] `src/types.d.ts` declara `*.html` e o shell embutido compila.
- [ ] Opções de tema e loader vêm no HTML do servidor (`<select>` preenchido sem JS).
- [ ] `bun test` cobre todas as libs de `core/`: config, markdown, themes, page, meta, frontmatter, slug e state.
- [ ] Teste de integração mínimo da `application` passa (`/__events`, broadcast, encerramento).
- [ ] Com uma aba aberta, o daemon não encerra por idle (heartbeat conta como atividade).
- [ ] `dist/` e `.plans/` estão no `.gitignore`.
- [ ] Todo `core/themes/catalog/*.json` validado por `validateTheme()` (nome, tokens, cores, variantes, Shiki); `schema.json` é só DX de editor.
- [ ] Nenhum literal de cor no código de tema: `rg -g '!catalog/**' '#[0-9a-fA-F]{6}' src/core/themes` não retorna nada.
- [ ] `themeCss` tem um único caminho; `auto` e tema fixo usam o mesmo gerador.
- [ ] `rg "window\.(mdprv|__mdprv)" src/ui` não retorna nada.
- [ ] `rg "localStorage|sessionStorage|document\.cookie" src/ui` só encontra `prefs.ts`.
- [ ] Nenhum cookie além de `mdprv_theme` é enviado ao daemon.
- [ ] Nenhuma preferência de UI é enviada ao daemon; escrita no daemon só por comando (`PUT /__register`, `POST /__shutdown`).
- [ ] Toda chave persistida aparece na tabela de *Gerenciamento de estado*.
- [ ] Recarregar limpa o zen; colapso, largura, loader, fonte e zoom sobrevivem.
- [ ] Cenários de `docs/bdd-scenarios.md` executados via MCP: similaridade visual + paridade de comportamento.
- [ ] Acessibilidade preservada (ARIA, foco e atalhos), verificada no snapshot de acessibilidade.
- [ ] Matriz coberta: temas (`auto` claro/escuro, `nord`), frontmatter/meta card, imagens relativas, GFM (footnote/tabela/task), Shiki por tema, opções de tema/loader, lightbox (zoom/scroll/pan/reset/`Esc`/backdrop), Mermaid incl. `architecture-beta`, sumário, histórico + toggles, settings (fonte/load/reset, loader, sensibilidade), zen, back-to-top, copy-code, overlay e idle+heartbeat.

## Plumbing

Aplicado agora:

- `dist/` e `.plans/` no `.gitignore` (`bin/` já estava).
- `server/` achatado na raiz; `adr/` e `docs/` versionados no mesmo repo.

Entra com a refatoração (os entrypoints ainda não existem):

- Scripts `build:client` (estágio 1), `build` (os dois), `typecheck` (dois tsconfigs) e `test` (`bun test`).
- `build.sh` orquestrando o estágio do cliente antes do `--compile`.
- README com o layout `application/` + `core/` + `ui/`.
