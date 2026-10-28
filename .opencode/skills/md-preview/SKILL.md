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
`http://127.0.0.1:8766/<slug>`. Sem `--open-browser`, só imprime a URL.

Documentação publicada: <https://github.com/jrmmendes/md-preview#readme>.

## Quando usar

- revisar o Markdown que um agente acabou de gerar;
- conferir frontmatter, tabelas, Mermaid e tree fences renderizados;
- testar a saída de um comando via `--pipe` antes de incorporá-la;
- validar um `theme.json` de usuário;
- diagnosticar daemon, porta ou token.

Não use para editar o documento no lugar do autor. O preview é somente leitura.

## Comandos mínimos

```sh
md-preview arquivo.md                    # registra e imprime a URL
md-preview a.md b.md --open-browser      # abre uma vez, no primeiro arquivo
md-preview arquivo.md --theme nord       # valida o tema e usa ?theme=nord
md-preview --version                     # 1.3.0 nesta instalação

comando | md-preview --pipe              # temporário observado, slug temp-<uuid>.md
comando | md-preview register --stdin --slug docs/relatorio
comando | md-preview register --stdin --slug docs/relatorio --path /abs/relatorio.md
```

- `--pipe` recusa arquivos posicionais, TTY e stdin vazio.
- `register` exige `--stdin` e `--slug`; imprime somente o slug final e nunca
  abre o navegador. `--path` habilita watch e imagens relativas.
- Arquivos repetidos (inclusive por symlink) são deduplicados pelo caminho real.
- Extensões aceitas: `.md`, `.markdown`, `.mdc`.

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
- frontmatter YAML vira cartão de metadados e título da aba;
- Shiki realça `js`, `ts`, `json`, `lua`, `bash`, `html`, `css`, `md` e `py`;
- fence `mermaid` renderiza no navegador via `/__assets/mermaid.min.js`;
- fence `tree` vira árvore interativa quando o corpo parece saída de `tree`;
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
