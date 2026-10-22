# ADR-0002 — Catálogo de fontes server-side e loader intencional

- **Status:** Aceito
- **Data:** 2026-10-22
- **Escopo:** `src/application/daemon/`, `src/core/fonts.ts`, `src/ui/`
- **Relacionado:** `adr/architecture-refactor.md`, `docs/bdd-scenarios.md`, `.plans/2026-10-22-1435-loader-consistente-fontes-server-side.md`

## Contexto

A UI antiga dependia de `window.queryLocalFonts()` e de um `<datalist>`. Isso exigia permissão do usuário, só funcionava em Chromium e não tinha busca, preview ou estado de indisponibilidade. O overlay de loading também era acionado apenas na troca de tema; navegação pela lista Recent e reload por live-reload não o mostravam, e alterações de fonte podiam piscar o overlay.

Restrições:

- Binário único e daemon local; a página continua funcionando sem JS para leitura.
- CSP sem origens externas (`font-src 'self' data:`, `connect-src 'self'`).
- Sem novas dependências npm.
- UI não importa runtime de `core/` nem `node:*` (regra do ADR-0001).

## Decisão

### Catálogo no daemon

- O daemon enumera famílias com `fc-list --format '%{family}\t%{style}\t%{spacing}\n'` (timeout de 3 s, saída limitada), agrega estilos por família e classifica a categoria de forma best-effort (`spacing` 100/110 indica monoespaçada; heurística de nome cobre serif/sans/script).
- O resultado fica em cache de memória por 5 min, com single-flight. `GET /__fonts?refresh=1` invalida. A resposta é JSON `no-store` com `available`, `source`, `fonts`, `generatedAt` e `total`.
- Ausência, erro ou timeout de `fc-list` retorna `available:false` e apenas famílias genéricas. Não existe lista estática fingindo ser o sistema.
- Google Fonts é opt-in. `GET /__fonts/google?family=...` busca o CSS `css2`, aceita apenas URLs `https://fonts.gstatic.com/`, baixa `.woff2`, cacheia por SHA-256 e reescreve os `@font-face` para `GET /__fonts/file/<hash>` (imutável). Família inválida retorna 400; falha/timeout upstream retorna 502.
- O navegador nunca contacta Google. O link injetado é same-origin; o CSP não muda.

### Seleção e aplicação sem FOUC

- `mdprv_font` passa a ser JSON `{ v: 1, family, source: "local"|"google", stack }`. A string legada é migrada para `source:"local"` com stack derivado; família e stack são validados (comprimento, controles, `;{}<>`, aspas/barra na família).
- `ui/services/font-value.ts` repete em pequena escala as regras de `sanitizeFamily`/`fontStack` do `core/`. A duplicação é intencional: a UI não pode importar runtime de `core/`.
- O script clássico inline no `<head>` lê a seleção, aplica `--mdprv-font` e, para Google, injeta `<link id="mdprv-font-google-css">` antes do `<body>`; erro do link marca `data-font-missing="1"`. Tudo em `try/catch` para nunca quebrar o boot.
- A ilha `font-picker.ts` é um combobox acessível (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete`, `aria-activedescendant`), com lista `role="listbox"` em fluxo (o painel tem `overflow:auto`), opções com `aria-selected` e preview na própria família. Teclado: setas, Home/End, Enter, Escape, Tab; mouse por `pointerdown` sem perder o foco. Status `role="status"` cobre carregando, contagem, sem resultado e indisponível.
- A busca é local e pura: normalização NFD sem diacríticos, ranking exato > prefixo > prefixo de palavra > substring > subsequência, desempate `localeCompare`, limite de 80.

### Loader intencional

- A intenção de navegação/reload fica em `sessionStorage` (`mdprv_loader_pending`) como `{v:1,path,ts}`, com idade máxima de 15 s e conferência de path; o legado `"1"` é aceito. A navegação interna same-tab é detectada por listener delegado; o reload explícito/F5 e o live-reload gravam a intenção.
- O script inline consome a intenção e/ou detecta `performance.getEntriesByType("navigation")[0].type === "reload"`, exceto `back_forward`. Cold start e bfcache não mostram overlay.
- `loader-state.ts` garante mínimo de 180 ms, teto de 600 ms para `document.fonts.ready`, timeout absoluto de 8 s (JS + fallback CSS) e `hide` idempotente. `prefers-reduced-motion` desliga animações.
- Troca de fonte não chama `settle()`; nenhuma alteração de fonte pisca o overlay.

## Alternativas rejeitadas

| Alternativa | Motivo |
| --- | --- |
| Manter `queryLocalFonts()` + `<datalist>` | Permissão por sessão, só Chromium, sem busca/preview/estado e sem acesso a fontes fora do sandbox do navegador |
| Lista estática de fontes no cliente | Enganosa: famílias ausentes falham silenciosamente e nunca refletem o sistema |
| Enumerar fontes no cliente e enviar ao daemon | Não resolve o suporte do navegador e adiciona superfície de escrita desnecessária |
| Busca no servidor | Latência por tecla, estado de query no daemon e ordenação dependente de rede; o catálogo é pequeno e cabe no cliente |
| Biblioteca de fuzzy search | +1 dependência para uma pontuação simples; subsequência + `localeCompare` cobre o caso |
| Cache em disco do catálogo | Invalidação e limpeza sem ganho: `fc-list` é barato e o TTL de 5 min já evita repetição |
| Link direto para `fonts.googleapis.com` | Exigiria afrouxar o CSP, quebra offline e expõe o usuário a terceiros; o proxy mantém `self` |
| Self-host de todas as fontes do Google | Aumenta o binário e não é necessário para um opt-in por família |
| Guardar fonte em cookie | O servidor não renderiza com a fonte; localStorage + script inline resolve sem bytes extras por request |
| Overlay sempre visível no boot | Pisca em cold start e em bfcache; a intenção explícita distingue navegação de carregamento inicial |
| `setTimeout` único como único mecanismo do loader | Não cobre fontes lentas nem reload; a máquina de estado mantém mínimo, teto e timeout absoluto testáveis |
| Lista de fontes como popup absoluto | O painel `.mdprv-settings` tem `overflow:auto` e cortaria o popup; a lista em fluxo mantém o teclado e o scroll previsíveis |

## Consequências

- A primeira resposta não tem FOUC de fonte: o stack salvo é aplicado antes do body.
- A UI funciona offline para fontes do sistema; Google só entra por ação explícita e continua same-origin.
- `fc-list` e o proxy Google são dependências opcionais de runtime do daemon; a ausência degrada para genéricas, nunca quebra a página.
- O script inline permanece uma exceção controlada e testada; lógica nova deve ir para `ui/services/`.
- Um `source:"google"` persistido faz uma requisição ao daemon a cada abertura de página; falha não bloqueia o conteúdo e sinaliza `data-font-missing`.

## Verificação

- `bun run typecheck`
- `bun test` (`tests/font-search.test.ts`, `tests/boot.test.ts`, `tests/shell.test.ts`, `tests/fonts.test.ts`, `tests/fonts-catalog.test.ts`, `tests/security.test.ts`)
- `bun run build`
