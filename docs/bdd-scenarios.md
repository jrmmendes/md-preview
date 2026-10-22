# Cenários BDD — paridade antes/depois

Cenários mínimos para validar a refatoração (`application/` + `core/` + `ui/`) por **similaridade visual e paridade de comportamento**, usando o **MCP do Playwright** como executor. Não há `playwright` no `package.json`; transformar isto em suíte permanente é outra decisão.

## Como executar

1. **Antes da migração** (baseline): criar a tag `pre-refactor` no commit atual, iniciar o daemon nessa versão, abrir a fixture e capturar, por cenário, screenshot + snapshot de acessibilidade + comportamento.
2. **Depois da migração**: repetir exatamente os mesmos passos e comparar com o baseline.
3. Guardar as capturas em `docs/baseline/<cenário>/` (fora do git ou com política própria).
4. Ferramentas do MCP: `playwright_browser_navigate`, `playwright_browser_take_screenshot`, `playwright_browser_snapshot`, `playwright_browser_click`, `playwright_browser_press_key`, `playwright_browser_evaluate`.
5. Viewport fixo: **1280×800**. Dois esquemas de SO: claro e escuro.

### Fixture de referência

Um único `.md` com: frontmatter (`title`, `date`, `tags`, objeto aninhado), `h1..h3` com âncoras, parágrafo, lista de tarefas, tabela, bloco de código (TS), bloco sem linguagem, footnote, imagem local e dois diagramas Mermaid — um `flowchart` e um `architecture-beta` (Mermaid 12.2.0 suporta). Sem a mesma fixture nos dois lados, a comparação não vale.

## Cenários

```gherkin
# language: pt
Funcionalidade: Paridade do preview de Markdown

  Contexto:
    Dado o daemon em execução e a fixture de referência aberta
    E o viewport em 1280x800

  Cenário: Tema automático no esquema claro
    Dado que o tema é "auto" e o SO está no esquema claro
    Então a página, o código e os diagramas correspondem ao baseline
    E o atributo data-theme é "auto"

  Cenário: Tema automático no esquema escuro
    Dado que o tema é "auto" e o SO está no esquema escuro
    Então a página, o código e os diagramas correspondem ao baseline escuro

  Cenário: Tema fixo não segue o sistema
    Dado que o tema é "nord"
    Quando o SO alterna entre claro e escuro
    Então a página, o código e os diagramas permanecem em nord

  Cenário: Realce de código por tema
    Dado um bloco de código TypeScript
    Então as cores dos tokens correspondem ao tema Shiki do baseline
    E em "auto" o bloco acompanha claro/escuro pelo CSS dual
    E em "nord" permanece nord independentemente do SO

  Cenário: Sumário reflete os headings
    Então o sumário lista os headings com id, indentados por nível
    Quando clico em um item
    Então a página rola até a seção, a URL recebe o hash e o item fica ativo
    E o item ativo acompanha a rolagem

  Cenário: Frontmatter e metadados
    Dado que a fixture tem frontmatter com title, date, tags e objeto aninhado
    Então o título da aba usa o title
    E o cartão de metadados abre e mostra date, tags como tags e o objeto como código
    E um arquivo sem frontmatter não mostra o cartão

  Cenário: Histórico e toggle
    Então a lista de recentes é preenchida pelo evento "slugs"
    E o documento atual aparece como ativo
    Quando clico no toggle do histórico
    Então o painel colapsa e o estado sobrevive ao reload

  Cenário: Painel de configurações
    Quando abro o painel pelo ícone de engrenagem
    Então vejo tema, fonte, loader e sensibilidade de scroll
    E o campo de fonte é um combobox com lista, status e ações Refresh/Reset

  Cenário: Busca e preview de fontes
    Quando foco o campo de fonte
    Então a lista mostra as famílias do catálogo com preview "Aa Bb Cc 0123"
    Quando digito "inter"
    Então os resultados priorizam igualdade, prefixo, prefixo de palavra, substring e subsequência
    E o status informa a contagem de resultados
    Quando digito um termo sem correspondência
    Então o status informa que não há resultados

  Cenário: Teclado do combobox de fontes
    Dado o campo de fonte focado
    Quando pressiono ArrowDown, ArrowUp, Home e End
    Então a opção ativa acompanha o movimento e aria-activedescendant é atualizado
    Quando pressiono Enter
    Então a fonte ativa é aplicada e persistida
    Quando pressiono Escape ou Tab
    Então a lista fecha sem alterar a fonte

  Cenário: Reset de fonte
    Dado uma fonte aplicada
    Quando clico em Reset
    Então --mdprv-font é removido, a chave mdprv_font é apagada e o padrão volta

  Cenário: Catálogo de fontes indisponível
    Dado que fc-list falhou
    Então o status informa indisponibilidade
    E as famílias genéricas continuam selecionáveis
    Quando clico em Refresh
    Então uma nova tentativa é feita com ?refresh=1

  Cenário: Google Fonts opt-in e offline
    Quando abro "Load from Google Fonts" e carrego uma família válida
    Então um link same-origin /__fonts/google?family=... é injetado e a escolha é persistida com source "google"
    Quando a rede falha ou a família não existe
    Então um erro explícito aparece, o link é removido e a fonte anterior permanece
    E o CSP continua sem origens Google

  Cenário: Navegação e loader
    Quando clico em um item Recent
    Então o overlay aparece antes do novo conteúdo
    Quando recarrego com F5
    Então o overlay aparece
    Quando uso back/forward (bfcache)
    Então o overlay não aparece
    E ele nunca fica preso após o timeout
    E prefers-reduced-motion desliga animações e transições

  Cenário: Opções de tema e loader
    Quando abro o painel de configurações
    Então o select de tema lista todos os temas do catálogo
    E o select de loader lista os seis loaders
    E a opção atual aparece selecionada
    E ambos já vêm preenchidos pelo servidor, sem depender de JS

  Cenário: Sensibilidade do zoom
    Quando ajusto a sensibilidade para 1.5 e recarrego
    Então o campo mantém 1.5
    E o scroll do lightbox usa o novo passo

  Cenário: Loader
    Quando troco de tema ou de loader
    Então o overlay aparece com o estilo escolhido
    E desaparece após o carregamento, respeitando o tempo mínimo

  Cenário: Lightbox do Mermaid
    Quando clico no botão de tela cheia de um diagrama
    Então o SVG é clonado no stage e o scroll do body é travado
    Quando uso +, -, scroll do mouse e arrasto
    Então zoom e pan mudam conforme o esperado
    Quando clico em reset
    Então o zoom volta a 100% e a posição ao centro
    Quando pressiono Esc ou clico no fundo
    Então o lightbox fecha e o scroll do body volta

  Cenário: Diagrama architecture-beta
    Dado um bloco Mermaid com "architecture-beta"
    Então o diagrama é renderizado como SVG, não como texto
    E o botão de tela cheia está disponível e funciona

  Cenário: Imagens relativas
    Dado um `![alt](img/foto.png)` na fixture
    Então o `src` é reescrito para `/img/<slug>/img/foto.png`
    E a imagem carrega

  Cenário: GFM
    Então tabela, strikethrough, task list e footnote são renderizados como no baseline
    E os checkboxes de task list refletem o Markdown

  Cenário: Copiar código
    Quando passo o mouse sobre um bloco de código
    Então o botão de copiar aparece
    Quando clico
    Então o conteúdo é copiado e o ícone vira check por cerca de 1,2s

  Cenário: Voltar ao topo
    Dado que estou no topo
    Então o botão está oculto
    Quando rolo mais de 300px
    Então o botão aparece
    Quando clico
    Então a página volta ao topo suavemente

  Cenário: Zen
    Quando pressiono "z" ou clico no botão
    Então sidebar e histórico somem e aria-pressed muda
    E "z" é ignorado quando o foco está em campo editável
    Quando recarrego
    Então o zen não persiste

  Cenário: Atualização em tempo real por SSE
    Dado que a página está aberta
    Quando altero a fixture no disco
    Então o daemon emite "version" em /__events
    E a página recarrega sem polling
    Quando abro uma nova aba
    Então recebo "snapshot" com versões e slugs
    Quando o daemon reinicia
    Então o EventSource reconecta e reidrata pelo snapshot

  Cenário: Idle e heartbeat
    Dado que a aba está aberta
    Quando o tempo ocioso ultrapassa MDPRV_IDLE sem navegação
    Então o daemon continua vivo por causa do ping
    Quando fecho a aba
    Então a conexão é encerrada e o idle volta a contar

  Cenário: Acessibilidade
    Então aria-label, aria-expanded, aria-pressed e role estão presentes
    E a navegação por teclado funciona (Tab, Enter, Esc)
    E o foco é visível

  Cenário: Leitura sem JavaScript
    Dado que o JavaScript está desabilitado
    Então o conteúdo, o tema e o CSS são aplicados
    E nenhum token {{mdprv-*}} aparece na página
```

## Matriz de cobertura

| Área | Cenários |
| --- | --- |
| Temas (tokens, Shiki, Mermaid) | automático claro/escuro, tema fixo, realce de código |
| Conteúdo | frontmatter/meta card, imagens relativas, GFM, Mermaid |
| Navegação | sumário, voltar ao topo, loader em Recent/F5/back-forward |
| Painéis | histórico + toggle, sidebar, settings, opções de tema/loader |
| Fontes | busca/preview, teclado, reset, catálogo indisponível, Google opt-in/offline |
| Mermaid | lightbox, `architecture-beta` |
| Código | copiar, realce por tema |
| Preferências | fonte, loader, sensibilidade, colapso |
| Tempo real | SSE (`version`, `slugs`, `snapshot`, reconexão), idle/heartbeat |
| Acessibilidade | ARIA, teclado, foco |
| Degradação | leitura sem JS |

## Critério de aprovação

- **Visual:** diferença de pixels apenas onde o redesign foi intencional (ex.: ordem do `<select>` alfabética). Fora isso, igual ao baseline.
- **Comportamento:** todos os cenários executam sem erro, com os mesmos efeitos observáveis.
- **Acessibilidade:** mesmos papéis/atributos e navegação por teclado.
- **Sem tokens:** nenhum `{{mdprv-*}}` visível, com ou sem JS.
