---
name: theme-authoring
description: >
  Autoria e ajuste de temas do md-preview: transforma uma referência visual em
  `theme.json` v1 válido, com tokens medidos, contraste WCAG conferido, Shiki
  coerente, Mermaid com overrides e smoke em claro/escuro. Use quando pedirem
  para criar/ajustar tema, editar `theme.json`, derivar variante dark/`auto`,
  mexer em tokens de cor/tipografia/layout, corrigir contraste ou trocar Shiki.
  Use ONLY quando o alvo for o contrato de temas deste repo (`themes/` ou
  `~/.config/md-preview/themes/`); não use para trocar a fonte do documento
  (catálogo próprio em `src/core/fonts.ts`).
---

# theme-authoring — autoria de temas

Referência longa (fases, tabelas de medição, derivação real e erros):
[`docs/theme-authoring-method.md`](https://github.com/jrmmendes/md-preview/blob/main/docs/theme-authoring-method.md).
Esta skill é o roteiro de execução; o doc é a fonte da verdade.

Princípio único: **medir antes de escrever**. Nenhuma cor entra no JSON por
imitação visual — toda cor e métrica vem de `getComputedStyle` ou de cálculo
explícito.

## Onde as coisas moram

| Caminho | Papel |
| --- | --- |
| `themes/theme.schema.json` | JSON Schema v1 (editor/consumidores) |
| `src/core/themes/validate.ts` | validador de runtime — **autoritativo**, mais estrito |
| `themes/<name>.json` | builtin: embutido no binário, exige `bun run build` |
| `${XDG_CONFIG_HOME:-~/.config}/md-preview/themes/<name>.json` | usuário: runtime, watch/SSE, sem rebuild, sobrescreve builtin; ≤ 256 KiB |
| `src/core/themes/defaults.ts` | defaults dos grupos/tokens opcionais |
| `src/core/themes/constants.ts` | lista fechada de Shiki/Mermaid e regex de nome |

`MDPRV_CONFIG_DIR` troca o diretório `md-preview` inteiro. Rode `theme path`
para ver os caminhos efetivos. Nome do tema = basename do arquivo (sem `.json`)
= campo `name` (`^[a-z0-9][a-z0-9-]{0,63}$`).

## Pré-requisitos

- Bun 1.x (`bun@1.4.3` fixado). Sem alias de CLI no `package.json`: use
  `bun run src/application/cli/index.ts ...` (fonte) ou `./bin/md-preview ...`
  (compilado, requer `bun run build`).
- Extração visual pelo **MCP do Playwright** (`playwright_browser_*`), como em
  `docs/bdd-scenarios.md`. Playwright não é dependência do projeto.

## Fluxo

### 1. Fixar escopo

Viewport 1280×800, `prefers-reduced-motion: reduce`, `color-scheme: light`
(repita em `dark` se o alvo tiver versão escura). Escolha o alvo (doc, landing,
app), salve screenshot de referência e liste os papéis reais: página, cartão,
elevado, texto, muted, hairline, CTA, link, chip de código, bloco de código,
citação, seleção. Descarte hover/animação/gradiente — meça o repouso.
Claro primeiro; dark vem na fase 7.

### 2. Extrair evidência

`playwright_browser_navigate` → `resize` → `emulate_media` → `evaluate` →
`take_screenshot`. Para cada papel, leia o elemento real (não um genérico) e
guarde seletor → valores + as custom properties de `:root` (revelam escala de
espaçamento/raio/tipografia). Dump bruto precisa ser auditável.

```js
() => {
  const read = (el) => {
    const s = getComputedStyle(el);
    return {
      color: s.color, background: s.backgroundColor,
      borderColor: s.borderTopColor, borderWidth: s.borderTopWidth,
      radius: s.borderRadius, fontFamily: s.fontFamily,
      fontSize: s.fontSize, lineHeight: s.lineHeight,
      padding: s.padding, width: s.width, maxWidth: s.maxWidth,
      boxShadow: s.boxShadow,
    };
  };
  const at = (sel) => { const el = document.querySelector(sel); return el ? read(el) : null; };
  const root = {};
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const rule of rules) {
      if (!rule.style) continue;
      for (const prop of rule.style)
        if (prop.startsWith("--")) root[prop] = rule.style.getPropertyValue(prop).trim();
    }
  }
  return { root, body: at("body"), main: at("main"), h1: at("h1"), p: at("p"),
    inlineLink: at("p a"), inlineCode: at("p code"), blockCode: at("pre"), cta: at("button") };
}
```

`getComputedStyle` devolve `rgb()/rgba()` (aceitos; hex só por legibilidade).
`line-height`: registre px e font-size do mesmo elemento (contrato usa número
adimensional). `border-radius` com 4 valores → raio dominante.

### 3. Normalizar para o contrato

Mapeie papel → token; **não invente token** (chave desconhecida é rejeitada).
Obrigatórios: `background`, `surface`, `text`, `muted`, `border`, `accent`,
`code-bg`, `quote`. Com default, mas declare quando carregam significado
visual: `surface-raised` (→`surface`), `border-strong` (→`border`),
`accent-fg` (→`background`), `link` (→`accent`), `code-fg` (→`text`),
`selection` (→`accent`), `danger/warning/success/info` (ver `defaults.ts`).
`accent-fg` é o caso crítico: o default quase sempre reprova.

Métricas: `typography.base-size` = font-size do body; `line-height` = px ÷
font-size; `heading-line-height` no `h1`; `code-line-height` idem no código;
`layout.content-width` = max-width ÷ 16 (`672px → 42rem`); `radii.sm…xl`
inteiros; `layout.*` em `px|rem|em|%|ch|vw|vh`.

Validador rejeita: nomes CSS (`white`), `url()`, `var()`, `calc()`; raios
`sm…xl` > 32; durações > 2s; `shadow-panel` fora de string segura;
`typography.family` com `;{}<>`/aspas/barra; `mermaid.overrides` com chave fora
de `^[A-Za-z][A-Za-z0-9]*$` ou valor > 200 chars.

Fonte proprietária (Styrene, Copernicus) **não é embutida**: declare no `stack`
com fallbacks e deixe o navegador resolver (`family: "system-ui"`).

### 4. Fechar contraste (WCAG 2.x)

Texto normal ≥ 4,5:1; texto grande (≥24px, ou ≥18,66px bold) e UI/foco ≥ 3:1;
`accent-fg` ≥ 4,5:1. Meça no mínimo: `text/background`, `muted/background`,
`muted/surface`, `link/background`, `accent-fg/accent`, `code-fg/code-bg`,
`quote/background`, e `selection` com o texto por cima.

```sh
bun -e '
const L=(h)=>{const c=h.replace("#","").match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2]};
const cr=(a,b)=>{const x=L(a),y=L(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)};
for (const [rotulo,a,b] of [["texto/fundo","#141413","#faf9f5"],["link/fundo","#a14a2e","#faf9f5"],["accent-fg/acento","#141413","#d97757"]]) console.log(rotulo, cr(a,b).toFixed(2));
'
```

Regra do acento: se o label claro passar ≥ 4,5:1 use-o; senão use o ink ou
escureça o acento. Nunca deixe `accent-fg` no default. Link costuma precisar de
tom mais escuro que o acento.

### 5. Shiki e Mermaid

Shiki aceita só 8 nomes (`src/core/themes/constants.ts`): `github-light`,
`github-dark`, `dracula`, `nord`, `solarized-dark`, `solarized-light`,
`gruvbox-dark-medium`, `gruvbox-light-medium`.

**Armadilha de polaridade:** `src/ui/styles/base.css` reaplica as cores do
Shiki no escuro com `!important` (`--shiki-dark*`), e `highlight.ts` alimenta os
dois slots com `theme.light.shiki.light` / `theme.dark.shiki.dark`. Logo: tema
claro → tema **claro nos dois slots**; tema escuro → tema **escuro nos dois**.

Escolha por evidência, não por gosto: suba o daemon com fixture contendo TS,
JSON, bash, CSS, Markdown e Python; colete `pre.shiki span` e o fundo efetivo
do `pre`; conte foregrounds com CR < 4,5:1; prefira menos falhas e fundo próximo
de `code-bg`.

Mermaid: `base` quando aplicar paleta própria, `neutral`/`default` para padrões.
O app já deriva variáveis de `background/surface/code-bg/text/link/accent/
border/muted` (`src/core/themes/mermaid.ts`); `overrides` só refina o visível.

### 6. Validar e fazer smoke

```sh
bun run src/application/cli/index.ts theme validate themes/<name>.json
bun test
bun run typecheck
bun run build                                  # obrigatório se builtin

./bin/md-preview daemon start
./bin/md-preview docs/fixtures/reference.md --theme <name>
./bin/md-preview daemon status
./bin/md-preview daemon stop
```

O comando imprime URL já com `?theme=<name>` (vence cookie/config; reutilize a
mesma URL). Confirme `theme list` com origem esperada e sem avisos, paleta em
inline code/bloco/tabela/citação/link/Mermaid, e screenshots em claro e escuro
(emule `colorScheme` e repita). Tema de usuário: salvar já recarrega via watch +
SSE. Builtin só aparece no binário após `bun run build`.

### 7. Derivar a variante dark

Copie a estrutura (radii, typography, layout, effects) e troque **só** as cores;
não recomece a medição. Preserve a família de matiz do claro (nada de
cinza-azulado), `kind: "dark"`, ambos os slots do Shiki escuros, re-meça todos
os pares, `accent-fg` normalmente inverte, sombra/overlay mais fortes, e
reaponte os `overrides` do Mermaid. Para alternância automática, crie um
terceiro arquivo `kind: "auto"` só com `variants.light` e `variants.dark`.

## Checklist final

- [ ] Arquivo regular (não symlink), ≤ 256 KiB, nome no regex e igual a `name`
- [ ] `schemaVersion: 1`; `kind` correto; fixo sem `variants`, `auto` só com `variants`
- [ ] 8 `colors` obrigatórios; `accent-fg`/`link`/`code-fg`/`border-strong`/`surface-raised`/`selection` explícitos quando importam
- [ ] Todos os pares ≥ 4,5:1 (3:1 justificado para texto grande/UI) e `accent-fg` medido
- [ ] `shiki.light` e `shiki.dark` na mesma polaridade do `kind`, tokens medidos, fundo ≈ `code-bg`
- [ ] `mermaid.theme` válido, chaves/vals dentro do limite, overrides reapontados no dark
- [ ] Nenhuma fonte proprietária embutida; `stack`/`mono-stack` com fallbacks
- [ ] `theme validate` + `bun test` + `bun run typecheck` + `bun run build` (builtin)
- [ ] Smoke em claro e escuro; `theme list` sem avisos, origem esperada
- [ ] Dark: mesma estrutura, cores re-medidas, matiz preservado

## Armadilhas

| Sintoma | Causa | Correção |
| --- | --- | --- |
| `unknown theme key "tokens"` | tema v0 antigo no dir do usuário | converter para `schemaVersion: 1` + `colors`, ou apagar |
| `theme seed` diz `skipped` | seed nunca sobrescreve | editar à mão ou apagar antes de semear |
| `name must equal the file name` | cópia renomeada / `name` divergente | validar com o nome final, sem renomear depois |
| CTA ilegível | `accent-fg` omitido (default = `background`) | declarar ink/branco medido |
| Bloco escuro em tema claro | `shiki.dark` escuro | tema claro nos dois slots |
| `must be a safe CSS color` | nome CSS, `url()`, `var()` | hex/rgb/hsl/transparent |
| `must be a safe CSS length` | `calc()` ou unidade fora da lista | pré-calcular em px/rem |
| `radii.sm must be between 0 and 32` | raio grande em `sm…xl` | limitar a 32 |
| Builtin não aparece | binário compilado antes da edição | `bun run build` ou iterar como usuário |
| Tema ignorado sem erro | symlink, nome fora do regex, > 256 KiB | arquivo regular, nome válido, tamanho ok |
| Dark “azulado” | derivado de cinza frio | preservar matiz e ajustar luminosidade |
| Avisos em todo `theme list` | arquivos legados no config do usuário | migrar/remover; builtin continua disponível |

## Template mínimo

Obrigatórios em tema fixo: `schemaVersion`, `name`, `kind`, 8 `colors`,
`shiki`, `mermaid`. `radii`/`typography`/`layout`/`effects` podem ser omitidos
(defaults de `defaults.ts`).

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
    "selection": "#ebc9b7"
  },
  "typography": {
    "family": "system-ui",
    "stack": "\"Source Sans 3\", \"Noto Sans\", system-ui, sans-serif"
  },
  "shiki": { "light": "github-light", "dark": "github-light" },
  "mermaid": { "theme": "base", "overrides": {} }
}
```
