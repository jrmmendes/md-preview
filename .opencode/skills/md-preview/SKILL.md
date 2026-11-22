---
name: md-preview
description: >
  Uso da CLI md-preview para revisar Markdown gerado por agente, testar pipe e
  stdin, validar temas e conferir o preview local. Use quando precisar renderizar
  um documento em 127.0.0.1:8766, registrar conteúdo sem gravar no projeto,
  escolher tema ou diagnosticar o daemon. Use ONLY para operar a CLI deste repo;
  para autoria de tema, carregue `theme-authoring`.
---

# md-preview — uso da CLI

O `md-preview` registra arquivos Markdown em um daemon local e serve uma URL em
`http://127.0.0.1:8766/<slug>`. Por padrão ele reutiliza a aba já conectada
(foca ou navega nela) e só abre o navegador quando nenhuma aba está conectada.
Use `--no-open-browser` para registrar sem abrir nem focar nada.

Documentação publicada: <https://github.com/jrmmendes/md-preview#readme>.

## Quando usar

- revisar o Markdown que um agente acabou de gerar;
- conferir frontmatter, tabelas, Mermaid, tree e diff fences renderizados;
- testar a saída de um comando via `--pipe` antes de incorporá-la;
- validar um `theme.json` de usuário;
- diagnosticar daemon, porta ou token.

Não use para editar o documento no lugar do autor. O preview é somente leitura.

## Comandos mínimos

```sh
md-preview arquivo.md                    # registra; abre só se não houver aba
md-preview a.md b.md --open-browser      # abre uma vez, no primeiro arquivo
md-preview a.md b.md --no-open-browser   # só registra: nunca abre nem foca
md-preview arquivo.md --theme nord       # valida o tema e usa ?theme=nord
md-preview --version                     # versão instalada

comando | md-preview --pipe              # temporário observado, slug temp-<uuid>.md
comando | md-preview register --stdin --slug docs/relatorio
comando | md-preview register --stdin --slug docs/relatorio --path /abs/relatorio.md
```

- `--pipe` recusa arquivos posicionais, TTY e stdin vazio.
- `register` exige `--stdin` e `--slug`; imprime somente o slug final e nunca
  abre o navegador. `--path` habilita watch e imagens relativas.
- `--no-open-browser` também desliga o foco da aba conectada: é a flag para
  testes automatizados e validação manual.
- Arquivos repetidos (inclusive por symlink) são deduplicados pelo caminho real.
- Extensões aceitas: `.md`, `.markdown`, `.mdc`.

## Validação manual (Playwright)

Nunca deixe a CLI abrir o navegador do sistema: registre com
`--no-open-browser` e abra as URLs pelo Playwright.

O padrão para validar troca de abas usa **quatro arquivos** numa única chamada:

```sh
md-preview um.md dois.md tres.md quatro.md --no-open-browser
```

- o stdout traz as quatro URLs, uma por linha;
- abra cada URL em uma aba do mesmo contexto Playwright;
- alterne as abas e valide estado ativo, foco, título, live reload e ativação
  pelo daemon;
- para revalidar após editar, repita a chamada com a flag — ela não abre nem
  foca nada;
- não use `--open-browser` em validação manual.

## Daemon

```sh
md-preview daemon start
md-preview daemon status   # exit 0 rodando, 1 parado
md-preview daemon stop
```

- escuta só `127.0.0.1:8766` (`MDPRV_PORT` muda a porta);
- inicia sozinho na primeira invocação e encerra após 15 minutos ociosos;
- grava `{ pid, port, token }` em
  `${XDG_STATE_HOME:-~/.local/state}/md-preview/daemon.json`, modo `0600`;
- nunca exponha a porta nem publique o estado: o serviço é de loopback.

Se a CLI disser que há um daemon sem token conhecido, rode `daemon stop` e
registre de novo. Apagar o estado com o processo vivo tem o mesmo efeito.

## Recursos do Markdown

- GFM: tabelas, riscado, task lists, footnotes, linkify, typographer, âncoras;
- tabelas GFM/CSV são interativas: ordenar, filtrar, pivotar, copiar
  Markdown/CSV, visualizar em gráfico e abrir em tela cheia;
- na toolbar, os toggles de cabeçalho (1ª linha/1ª coluna) são botões de ícone;
  clique no fundo da barra limpa a seleção de células;
- tela cheia da tabela: arraste para mover, controles de zoom, redimensionamento
  simétrico pelas 4 bordas e pelos 4 cantos; o tamanho fica em `sessionStorage`
  por documento/tabela e a barra de rolagem do palco fica oculta;
- duplo clique na tabela ou na toolbar recentraliza e descarta o tamanho manual
  (mantém o zoom);
- frontmatter YAML vira cartão de metadados e título da aba;
- Shiki realça `js`, `ts`, `json`, `lua`, `bash`, `html`, `css`, `md`, `py`,
  `rust`, `go`, `yaml`, `tsx`, `jsx`, `sql` e `xml`;
- fence `mermaid` renderiza no navegador via `/__assets/mermaid.min.js`;
- fence `tree` vira árvore interativa quando o corpo parece saída de `tree`;
- fence `diff` vira diff estilo GitHub com alternância inline/lado a lado; a
  linguagem opcional (`diff tsx`) liga o realce por linha; trecho colado só com
  linhas `+`/`-`/contexto (sem cabeçalhos) vira diff simples, sem numeração;
- imagens relativas são servidas em `/img/<slug>/...`, restritas ao diretório do
  documento registrado;
- HTML inline funciona sob CSP com nonce: `<script>`, `onclick` e
  `javascript:` não executam.

## Temas

- nove embutidos: `auto`, `github-light`, `github-dark`, `dracula`,
  `gruvbox-dark`, `gruvbox-light`, `nord`, `solarized-dark`, `solarized-light`;
- precedência: `?theme=` > cookie `mdprv_theme` > `config.json`/`MDPRV_THEME` >
  `auto`;
- usuário: `~/.config/md-preview/themes/<nome>.json`, sobrescreve o embutido de
  mesmo nome; máximo 256 KiB; symlink é ignorado.

```sh
md-preview theme list
md-preview theme path
md-preview theme seed
md-preview theme validate ~/.config/md-preview/themes/meu-tema.json
```

Para criar ou ajustar tema, use a skill `theme-authoring`.

## Saída e erros

- sucesso: código `0`;
- erro de uso, arquivo inválido, tema desconhecido ou validação: `1`;
- mensagens vão para stderr com prefixo `md-preview:`.
- `daemon status` usa `1` quando o daemon está parado — não trate como falha.

## Limites

Não há servidor MCP, acesso remoto nem busca entre documentos. O Recent vive em
memória e some quando o daemon reinicia. `/` responde `404`: abra a URL de um
slug registrado.
