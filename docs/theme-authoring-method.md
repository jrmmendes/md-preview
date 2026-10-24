# Método de autoria de temas

Método repetível para transformar uma referência visual em um `theme.json` v1 válido,
com contraste medido e smoke nos dois esquemas. O exemplo trabalhado é o par
`anthropic` / `anthropic-dark`, derivado de <https://claude.com/resources>.

Princípio único: **medir antes de escrever**. Nenhuma cor entra no JSON por imitação
visual; toda cor e toda métrica vem de `getComputedStyle` ou de um cálculo explícito.

## 1. Objetivo e quando usar

Use este método para:

- adicionar um tema em `themes/` (builtin, embutido no binário);
- criar ou ajustar um tema em `~/.config/md-preview/themes/` (usuário, sem rebuild);
- portar uma paleta de site, marca ou design system para o contrato do app.

Não use para trocar a fonte do documento: o app tem catálogo e seletor próprios
(`src/core/fonts.ts`, `src/ui/islands/font-picker.ts`). O tema só declara nomes e
fallbacks.

Critério de pronto:

| Critério | Verificação |
| --- | --- |
| Contrato válido | `theme validate` retorna `ok` |
| Contraste AA | todos os pares de texto ≥ 4,5:1; UI ≥ 3:1 |
| Código coerente | Shiki escolhido com tokens ≥ 4,5:1 na amostra |
| Diagramas coerentes | Mermaid com overrides da mesma paleta |
| Sem regressão | `bun test`, `bun run typecheck`, `bun run build` |
| Smoke visual | fixture aberta em claro e escuro, com screenshot |

## 2. Pré-requisitos

Bun 1.x (o repo fixa `bun@1.4.3` em `package.json`). Nada de Playwright é dependência
do projeto; a extração usa o MCP do Playwright, como em `docs/bdd-scenarios.md`.

### 2.1 Onde cada coisa mora

| Caminho | Papel |
| --- | --- |
| `themes/theme.schema.json` | JSON Schema (draft 2020-12) do contrato v1; usado pelo editor via `$schema` e por consumidores externos |
| `src/core/themes/validate.ts` | Validador de runtime — **autoritativo** e mais estrito que o schema |
| `themes/<name>.json` | Temas builtin; importados estaticamente e embutidos no binário |
| `${XDG_CONFIG_HOME:-~/.config}/md-preview/themes/<name>.json` | Temas de usuário; lidos em runtime e sobrepõem o builtin de mesmo nome |
| `src/core/themes/store.ts` | Merge builtin ↔ usuário, watch, erros de arquivo |
| `src/core/themes/defaults.ts` | Defaults dos grupos opcionais |
| `src/core/themes/css.ts` | Token → variável CSS (`--mdprv-*`) |
| `src/core/themes/mermaid.ts` | Variáveis Mermaid derivadas das cores |

`MDPRV_CONFIG_DIR` substitui o diretório `md-preview` inteiro. `theme path` imprime
os caminhos efetivos.

### 2.2 Builtin vs. usuário

| | Builtin (`themes/`) | Usuário (`.../md-preview/themes/`) |
| --- | --- | --- |
| Precisa rebuild para aparecer no binário | sim (`bun run build`) | não |
| Sobrepõe o builtin de mesmo nome | — | sim, em memória |
| É sobrescrito por `theme seed` | — | não (arquivo existente é ignorado) |
| Watch/live reload | não | sim (evento SSE `themes`) |
| Limite de tamanho lido pelo store | — (vem do bundle) | 256 KiB |
| Nome do arquivo | `^[a-z0-9][a-z0-9-]{0,63}$` | idem |

O nome do tema **é** o basename do arquivo, sem `.json`, e o campo `name` precisa ser
idêntico. `theme validate` deriva o nome do basename: validar uma cópia renomeada falha.

### 2.3 CLI real

Não há alias no `package.json` para rodar a CLI em desenvolvimento. Use a entrada
TypeScript ou o binário compilado:

```sh
# fonte (sem build; reflete themes/*.json na hora)
bun run src/application/cli/index.ts theme path
bun run src/application/cli/index.ts theme list
bun run src/application/cli/index.ts theme list --json
bun run src/application/cli/index.ts theme validate themes/<name>.json
bun run src/application/cli/index.ts theme seed

# binário compilado (exige bun run build antes)
./bin/md-preview theme validate themes/<name>.json
./bin/md-preview theme list --json
```

## 3. Método em fases

### Fase 1 — Fixar escopo e referência

1. Escolha o alvo e o que ele representa: página de documentação, landing, app.
2. Fixe viewport e esquema: 1280×800, `prefers-reduced-motion: reduce`,
   `color-scheme: light` (repita em `dark` se o alvo tiver versão escura).
3. Abra com Playwright headless e salve um screenshot de referência.
4. Identifique os papéis reais antes de medir: fundo da página, cartão, cartão
   elevado, texto primário/secundário, hairline, CTA (fill e label), link inline,
   chip de código inline, bloco de código, citação, seleção.
5. Descarte estados transitórios (hover, animação, gradiente decorativo). Meça o
   estado de repouso.

O tema claro é sempre o primeiro. A variante escura é derivada depois (Fase 7).

### Fase 2 — Extrair evidência

Ferramentas: `playwright_browser_navigate`, `playwright_browser_resize`,
`playwright_browser_emulate_media`, `playwright_browser_evaluate`,
`playwright_browser_take_screenshot`.

Colete, para cada papel, um objeto com valor computado e o seletor que o produziu.
Adapte os seletores ao alvo; meça o elemento real, não um genérico.

```js
() => {
  const read = (el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color,
      background: s.backgroundColor,
      borderColor: s.borderTopColor,
      borderWidth: s.borderTopWidth,
      radius: s.borderRadius,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      lineHeight: s.lineHeight,
      padding: s.padding,
      width: s.width,
      maxWidth: s.maxWidth,
      boxShadow: s.boxShadow,
    };
  };
  const at = (sel) => {
    const el = document.querySelector(sel);
    return el ? read(el) : null;
  };
  const root = {};
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; } // folha cross-origin
    for (const rule of rules) {
      if (!rule.style) continue;
      for (const prop of rule.style) {
        if (prop.startsWith("--")) root[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }
  return {
    root,
    body: at("body"),
    main: at("main"),
    h1: at("h1"),
    p: at("p"),
    inlineLink: at("p a"),
    inlineCode: at("p code"),
    blockCode: at("pre"),
    cta: at("button"),
  };
}
```

Regras de coleta:

- `getComputedStyle` devolve `rgb()`/`rgba()`; o contrato aceita `rgb()`/`hsl()` e hex.
  Converta para hex só por legibilidade.
- Para `line-height`, registre o valor em px e o `font-size` do mesmo elemento: o
  contrato usa número adimensional.
- Leia também as custom properties de `:root` — elas revelam a escala real de
  espaçamento, raio e tipografia sem inferência.
- `border-radius` pode vir com quatro valores; use o raio dominante do componente.
- `box-shadow` é aceito como string segura (sem `url()`, `var()`, `;`, `{}`).
- Salve o dump bruto (seletor → valores) junto do screenshot. A normalização da fase
  seguinte precisa ser auditável.

Exemplo de medição (tema claro do Claude): fundo `#faf9f5`, cartão `#f5f4ed`, chip de
código `#f0eee6`, texto `#141413`, acento `#d97757`, link `#a14a2e`.

### Fase 3 — Normalizar para o contrato

Mapeie papéis para tokens. Não crie token novo: o validador rejeita chave desconhecida.

| Evidência no alvo | Token | Default se omitido |
| --- | --- | --- |
| Fundo da página | `background` | obrigatório |
| Fundo de cartão/painel | `surface` | obrigatório |
| Fundo elevado (menu, popover) | `surface-raised` | `surface` |
| Texto primário e títulos | `text` | obrigatório |
| Texto secundário/legenda | `muted` | obrigatório |
| Hairline/divisória | `border` | obrigatório |
| Divisória forte/borda de input | `border-strong` | `border` |
| Fill do CTA/destaque | `accent` | obrigatório |
| Texto sobre o acento | `accent-fg` | `background` |
| Link inline | `link` | `accent` |
| Chip de código inline | `code-bg` | obrigatório |
| Texto de código | `code-fg` | `text` |
| Citação | `quote` | obrigatório |
| Seleção de texto | `selection` | `accent` |
| Erro/aviso/sucesso/info | `danger` / `warning` / `success` / `info` | ver `defaults.ts` |

Obrigatórios: `background`, `surface`, `text`, `muted`, `border`, `accent`, `code-bg` e
`quote`. Os demais têm default, mas **declare
explicitamente** `accent-fg`, `link`, `code-fg`, `border-strong`, `surface-raised` e
`selection` quando carregarem significado visual. `accent-fg` é o caso crítico: o
default é `background`, que costuma reprovar em contraste.

Métricas:

| Token | Como derivar | Exemplo medido |
| --- | --- | --- |
| `typography.base-size` | `font-size` do body em px | `16` |
| `typography.line-height` | line-height px ÷ font-size px | `24 / 16 = 1.5` |
| `typography.heading-line-height` | idem no `h1` | `1.1` |
| `typography.code-line-height` | line-height do código ÷ font-size do código | `23.625 / 13.5 = 1.75` |
| `layout.content-width` | `max-width` do artigo em px ÷ 16 | `672px → 42rem` |
| `radii.sm…xl` | `border-radius` em px, inteiro | `4, 8, 12, 16` |
| `layout.*` | px/rem/em/%/ch/vw/vh | `3rem`, `1.5rem` |

Restrições que o validador impõe:

- cores: `hex` (3–8 dígitos), `rgb()`, `hsl()` ou `transparent`; **nomes CSS não valem**
  (`white`, `black`) e `url()`/`var()` são rejeitados;
- comprimentos: `px|rem|em|%|ch|vw|vh`, sem `calc()`;
- raios: inteiros; `sm`–`xl` ≤ 32, `none|pill|circle` ≤ 9999;
- durações: `ms|s`, no máximo 2s;
- `shadow-panel`: `none` ou string de sombra com caracteres seguros;
- `typography.family`: nome seguro (sem `;`, `{}`, `<>`, aspas, barra invertida);
- `mermaid.overrides`: chave `^[A-Za-z][A-Za-z0-9]*$`, valor ≤ 200 caracteres, ≤ 512 entradas.

Tipografia proprietária (Styrene, Copernicus) **não é embutida**. Declare o nome no
`stack` com fallbacks e deixe o navegador resolver:

```json
{
  "typography": {
    "family": "system-ui",
    "stack": "\"Styrene B\", \"Inter\", \"Segoe UI\", system-ui, -apple-system, sans-serif"
  }
}
```

### Fase 4 — Fechar contraste

Fórmula WCAG 2.x:

```text
c = canal / 255
c_lin = c/12.92                se c ≤ 0.03928
c_lin = ((c+0.055)/1.055)^2.4  caso contrário
L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
CR = (L_claro + 0.05) / (L_escuro + 0.05)
```

Limites:

| Uso | Mínimo |
| --- | --- |
| Texto normal (inclui `muted`, `link`, `quote`, `code-fg`) | 4,5:1 |
| Texto grande (≥ 24px, ou ≥ 18,66px em negrito) | 3:1 |
| Componentes de UI e foco (borda de input, outline) | 3:1 |
| Texto sobre `accent` (`accent-fg`) | 4,5:1 |
| AAA (opcional) | 7:1 |

Pares que precisam ser medidos, no mínimo: `text/background`, `muted/background`,
`muted/surface`, `link/background`, `accent-fg/accent`, `code-fg/code-bg`,
`quote/background`, `selection` com o texto por cima.

Cálculo reproduzível:

```sh
bun -e '
const L=(h)=>{const c=h.replace("#","").match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for (const [rotulo,a,b] of [["texto/fundo","#141413","#faf9f5"],["link/fundo","#a14a2e","#faf9f5"],["branco/acento","#ffffff","#d97757"]]) console.log(rotulo, cr(a,b).toFixed(2));
'
```

Decisões reais que o cálculo forçou:

| Par | CR | Decisão |
| --- | --- | --- |
| `#ffffff` sobre `#d97757` (accent clay) | **3,12** | reprovado para texto normal |
| `#141413` sobre `#d97757` | **5,90** | `accent-fg` passou a ser o ink, não branco |
| `#a14a2e` sobre `#faf9f5` (link) | **5,64** | link escurecido em relação ao acento |
| `#141413` sobre `#faf9f5` | 17,50 | texto principal |
| `#5e5d59` sobre `#faf9f5` (muted) | 6,26 | ok |
| `#141413` sobre `#f0eee6` (código) | 15,87 | ok |

Regra de decisão para `accent`:

1. Meça o label claro e o ink sobre o acento.
2. Se o claro ≥ 4,5:1, use-o como `accent-fg`.
3. Se não, use o ink (≥ 4,5:1) ou escureça o acento até o label claro passar.
4. Nunca deixe `accent-fg` no default (`background`) sem medir.

### Fase 5 — Escolher Shiki e Mermaid

Shiki aceita apenas oito nomes (`src/core/themes/constants.ts`):
`github-light`, `github-dark`, `dracula`, `nord`, `solarized-dark`,
`solarized-light`, `gruvbox-dark-medium`, `gruvbox-light-medium`.

**Armadilha de polaridade.** `src/ui/styles/base.css` reaplica as cores do Shiki
dentro de `@media (prefers-color-scheme: dark)` com `!important`, usando
`--shiki-dark` / `--shiki-dark-bg`, independentemente do `kind` do tema. E
`codeToHtml` alimenta os dois slots com `theme.light.shiki.light` e
`theme.dark.shiki.dark` (`src/core/markdown/highlight.ts`). Portanto:

- tema fixo claro → `shiki.light` **e** `shiki.dark` com um tema claro;
- tema fixo escuro → `shiki.light` **e** `shiki.dark` com um tema escuro.

Se um tema claro declarar `shiki.dark` escuro, o bloco de código vira escuro quando o
SO está no escuro. Os builtins confirmam a regra: `github-light.json` usa
`github-light` nos dois slots; `anthropic-dark.json` usa `github-dark` nos dois.

Seleção por evidência, não por gosto:

1. suba o daemon com uma fixture que contenha TS, JSON, bash, CSS, Markdown e Python;
2. para cada candidato, colete as cores de `pre.shiki span` e o fundo efetivo do `pre`;
3. conte cores distintas de foreground com CR < 4,5:1;
4. escolha o candidato com menos falhas e menor gravidade; confirme que o fundo do
   tema Shiki é próximo de `code-bg` (sob OS escuro o `!important` pode usar o fundo
   do Shiki, não o token).

Resultado observado na amostra usada (depende da amostra; re-meça):

| Candidato | Tokens < 4,5:1 | Pior caso | Decisão |
| --- | --- | --- | --- |
| `gruvbox-light-medium` | 3 | — | rejeitado |
| `solarized-light` | 6 | — | rejeitado |
| `github-light` | 1 | `#e36209` em 3,49:1 | escolhido |

Mermaid: escolha `base` quando for aplicar paleta própria (é o caso do tema
trabalhado), `neutral`/`default` quando quiser os padrões. O app já injeta variáveis
derivadas das cores (`src/core/themes/mermaid.ts`):

| Variável | Origem |
| --- | --- |
| `background` | `background` |
| `primaryColor` | `code-bg` |
| `mainBkg` | `surface` |
| `primaryTextColor`, `textColor`, `titleColor` | `text` |
| `lineColor` | `link` |
| `nodeBorder`, `primaryBorderColor` | `accent` |
| `clusterBorder` | `border` |
| `secondaryColor` | `muted` |
| `tertiaryColor`, `clusterBkg`, `edgeLabelBackground` | `background` |

Os `overrides` refinam o que for visível no seu caso. Chaves usadas no tema de
referência: `background`, `primaryColor`, `primaryTextColor`, `primaryBorderColor`,
`secondaryColor`, `tertiaryColor`, `textColor`, `titleColor`, `lineColor`,
`nodeBorder`, `clusterBkg`, `clusterBorder`, `edgeLabelBackground`, `noteBkgColor`,
`noteTextColor`, `noteBorderColor`, `errorBkgColor`, `errorTextColor`, `fontFamily`,
`fontSize`.

### Fase 6 — Validar e fazer smoke

Validação estática:

```sh
bun run src/application/cli/index.ts theme validate themes/<name>.json
bun test
bun run typecheck
bun run build            # obrigatório se o tema for builtin
```

O JSON Schema em `themes/theme.schema.json` serve ao editor (`$schema`) e a
consumidores externos; o caminho oficial no repo é `theme validate`, que é mais
estrito. Use os dois, mas trate o validador de runtime como fonte de verdade.

Smoke com daemon (a fixture já cobre inline code, tabela, código e Mermaid):

```sh
./bin/md-preview daemon start
./bin/md-preview docs/fixtures/reference.md --theme <name>
./bin/md-preview daemon status
./bin/md-preview daemon stop
```

O comando imprime a URL e ela já contém `?theme=<name>`. `?theme=` vence cookie e
configuração; use a mesma URL para reabrir sem reiniciar o daemon. Confirme:

- `theme list` mostra o nome com `builtin` ou `user` e nenhum aviso para ele;
- chip de inline code, bloco de código, tabela, citação, links e Mermaid usam a paleta;
- screenshot em claro e em escuro (emule `colorScheme` no Playwright e repita).

Para tema de usuário não há rebuild: salvar o arquivo dispara o watch e o SSE recarrega
a aba quando o tema atual muda. Para builtin, `./bin/md-preview` só enxerga o arquivo
novo depois de `bun run build`.

### Fase 7 — Derivar a variante dark

Copie a estrutura (radii, typography, layout, effects) e troque **só** as cores. Não
recomece a medição do zero: preserve o matiz e ajuste luminosidade/croma.

Regras:

- mantenha a família de matiz do claro (o par do Claude continua quente; nada de
  cinza-azulado);
- `kind: "dark"`, `shiki.light` e `shiki.dark` com tema escuro;
- re-meça todos os pares ≥ 4,5:1; `accent-fg` costuma inverter para o fundo escuro;
- sombra mais forte e overlay mais opaco (`rgba(0,0,0,.45)`, `rgba(0,0,0,.6)`);
- reaponte os `overrides` do Mermaid para as cores escuras;
- se quiser que o app alterne sozinho, crie um terceiro arquivo `kind: "auto"` com
  `variants.light` e `variants.dark` e nenhum outro grupo.

Derivação real (claro → escuro):

| Token | Claro | Escuro | CR no escuro |
| --- | --- | --- | --- |
| `background` | `#faf9f5` | `#1f1e1d` | — |
| `surface` | `#f5f4ed` | `#262625` | — |
| `code-bg` | `#f0eee6` | `#211f1e` | — |
| `text` | `#141413` | `#f5f4ed` | 15,10 sobre bg |
| `muted` | `#5e5d59` | `#a8a69e` | 6,83 sobre bg |
| `accent` | `#d97757` | `#dd7f61` | — |
| `accent-fg` | `#141413` | `#1f1e1d` | 5,77 sobre accent |
| `link` | `#a14a2e` | `#e8956f` | 7,10 sobre bg |
| `code-fg` | `#141413` | `#f5f4ed` | 14,89 sobre code-bg |

## 4. Checklist final

- [ ] Arquivo `<name>.json` regular (não symlink), ≤ 256 KiB, nome no regex e igual a `name`
- [ ] `schemaVersion: 1`; `kind` correto; tema fixo sem `variants`, auto só com `variants`
- [ ] Os 8 `colors` obrigatórios presentes
- [ ] `accent-fg`, `link`, `code-fg`, `border-strong`, `surface-raised` e `selection` explícitos quando importam
- [ ] Todos os pares de texto ≥ 4,5:1 (ou 3:1 justificado para texto grande/UI)
- [ ] `accent-fg` medido, não deixado no default
- [ ] `shiki.light` e `shiki.dark` com a mesma polaridade do `kind`
- [ ] Tokens do Shiki medidos na amostra; poucas falhas e fundo próximo de `code-bg`
- [ ] `mermaid.theme` válido; chaves `^[A-Za-z][A-Za-z0-9]*$`; valores ≤ 200
- [ ] Nenhuma fonte proprietária embutida; `stack`/`mono-stack` com fallbacks
- [ ] `bun run src/application/cli/index.ts theme validate themes/<name>.json`
- [ ] `bun test`
- [ ] `bun run typecheck`
- [ ] `bun run build` (builtin)
- [ ] `./bin/md-preview docs/fixtures/reference.md --theme <name>` em claro e escuro
- [ ] Screenshots conferidos: inline code, bloco, tabela, citação, link, Mermaid
- [ ] `theme list` sem avisos para o nome e com a origem esperada
- [ ] Dark: mesma estrutura, cores re-medidas, sem cinza-azulado

## 5. Erros comuns

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `unknown theme key "tokens"` | tema v0 antigo semeado no diretório do usuário | converter para `schemaVersion: 1` com `colors`, ou apagar o arquivo |
| Avisos de tema inválido em todo `theme list` | arquivos legados no config do usuário | migrar/remover; o builtin continua disponível |
| `theme seed` reporta `skipped` | seed nunca sobrescreve | editar o arquivo manualmente, ou apagar antes de semear |
| `name must equal the file name` | validação de cópia renomeada, ou `name` divergente | validar o arquivo com o nome final |
| Label do CTA ilegível | `accent-fg` omitido (default = `background`) | declarar ink ou branco medido |
| Branco sobre accent clay em 3,12:1 | contraste insuficiente para texto normal | usar ink (`5,90:1`) ou escurecer o accent |
| Link reprovado | link usando o accent cru | derivar um tom mais escuro e medir |
| Bloco de código escuro em tema claro | `shiki.dark` com paleta escura | usar tema claro nos dois slots |
| `colors.background must be a safe CSS color` | nome CSS (`white`) ou `url()`/`var()` | usar hex/rgb/hsl/transparent |
| `layout.* must be a safe CSS length` | `calc()` ou unidade fora da lista | pré-calcular em px/rem |
| `radii.sm must be between 0 and 32` | raio grande em `sm`–`xl` | limitar a 32 |
| Tema builtin não aparece no binário | binário compilado antes da edição | `bun run build`, ou iterar como tema de usuário |
| Tema ignorado sem erro | symlink, nome fora do regex ou arquivo > 256 KiB | arquivo regular, nome válido, tamanho menor |
| Dark “azulado” | paleta escura derivada de cinza frio | preservar matiz do claro e ajustar luminosidade |

## 6. Template mínimo

Obrigatórios em um tema fixo: `schemaVersion`, `name`, `kind`, os 8 `colors` e
`shiki`/`mermaid`. Os grupos `radii`, `typography`, `layout` e `effects` podem ser
omitidos e caem nos defaults de `src/core/themes/defaults.ts`.

```json
{
  "$schema": "./theme.schema.json",
  "schemaVersion": 1,
  "name": "<name>",
  "kind": "light",
  "colors": {
    "background": "#faf9f5",
    "surface": "#f5f4ed",
    "surface-raised": "#ffffff",
    "text": "#141413",
    "muted": "#5e5d59",
    "border": "#e8e6dc",
    "border-strong": "#d1cfc5",
    "accent": "#d97757",
    "accent-fg": "#141413",
    "link": "#a14a2e",
    "code-bg": "#f0eee6",
    "code-fg": "#141413",
    "quote": "#5e5d59",
    "danger": "#bf4d43",
    "warning": "#8a5410",
    "success": "#3f6e5e",
    "info": "#3f6f9e",
    "selection": "#ebc9b7"
  },
  "radii": { "none": 0, "sm": 4, "md": 8, "lg": 12, "xl": 16, "pill": 999, "circle": 9999 },
  "typography": {
    "family": "system-ui",
    "stack": "\"Source Sans 3\", \"Noto Sans\", \"Segoe UI\", system-ui, sans-serif",
    "mono-stack": "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, Consolas, monospace",
    "base-size": 16,
    "ui-size": 13,
    "small-size": 12,
    "line-height": 1.5,
    "heading-line-height": 1.1,
    "code-line-height": 1.75,
    "weight-normal": 400,
    "weight-bold": 600
  },
  "layout": {
    "content-width": "42rem",
    "sidebar-width": "16rem",
    "scroll-offset": "7rem",
    "article-padding-y": "3rem",
    "article-padding-x": "1.5rem",
    "article-padding-bottom": "7rem",
    "control-height": "2rem",
    "code-padding": "1rem",
    "table-cell-padding": ".5em .75em"
  },
  "effects": {
    "shadow-panel": "0 4px 20px rgba(20,20,19,.04)",
    "overlay": "rgba(20,20,19,.35)",
    "blur": "8px",
    "duration-fast": ".15s",
    "duration-ui": ".2s",
    "easing": "cubic-bezier(.2,.6,.2,1)"
  },
  "shiki": { "light": "github-light", "dark": "github-light" },
  "mermaid": { "theme": "base", "overrides": {} }
}
```

Tema automático correspondente:

```json
{
  "$schema": "./theme.schema.json",
  "schemaVersion": 1,
  "name": "auto",
  "kind": "auto",
  "variants": { "light": "anthropic", "dark": "anthropic-dark" }
}
```

## 7. Referências

| Arquivo | O que define |
| --- | --- |
| `themes/theme.schema.json` | contrato v1 em JSON Schema |
| `src/core/themes/validate.ts` | validação de runtime (autoritativa) |
| `src/core/themes/types.ts` | grupos e chaves de token |
| `src/core/themes/defaults.ts` | defaults de cores opcionais e grupos |
| `src/core/themes/store.ts` | merge builtin/usuário, watch, erros, limites |
| `src/core/themes/seed.ts` | semeadura sem sobrescrita |
| `src/core/themes/css.ts` | token → `--mdprv-*` |
| `src/core/themes/mermaid.ts` | variáveis Mermaid derivadas |
| `src/core/themes/constants.ts` | listas de Shiki/Mermaid, regex de nome |
| `src/core/markdown/highlight.ts` | slots claro/escuro do Shiki |
| `src/ui/styles/base.css` | aplicação do Shiki com `!important` no escuro |
| `src/application/cli/commands/theme.ts` | `list`, `validate`, `path`, `seed` |
| `themes/github-light.json` | exemplo de tema claro builtin |
| `themes/auto.json` | exemplo mínimo de `kind: "auto"` |
| `README.md` (seção Themes) | contrato resumido e comandos |
| `docs/fixtures/reference.md` | fixture de smoke |
| `docs/bdd-scenarios.md` | uso do MCP do Playwright |
