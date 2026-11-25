<div align="center">

# md-preview

Abra arquivos Markdown no navegador: renderização local, live reload e temas.
Inclui os 65 temas Shiki embutidos e importação de temas de cores
(`theme.json`), Shiki (`.shiki.json`) e Mermaid (`.mermaid.json`) em
**Temas → Importar** no modal de configurações. As mudanças do modal ficam em
rascunho até **Salvar** (`Ctrl/Cmd+S`); fechar sem salvar descarta tudo.

<img width="1804" height="1116" alt="Documento Markdown renderizado no md-preview" src="https://github.com/user-attachments/assets/46cf31a6-d856-4592-b308-672c289a4966" />

</div>

## Instalação rápida

Linux x64 ou arm64, direto da [última release](https://github.com/jrmmendes/md-preview/releases/latest):

```sh
curl -LO https://github.com/jrmmendes/md-preview/releases/latest/download/md-preview-linux-x64
chmod +x md-preview-linux-x64
mkdir -p ~/.local/bin && mv md-preview-linux-x64 ~/.local/bin/md-preview

md-preview --version
md-preview notas.md                   # primeira execução abre; as seguintes focam a aba
```

Em `aarch64`, troque `linux-x64` por `linux-arm64`. O binário baixado não exige
Bun nem Node; Bun só é necessário para compilar do código-fonte. Passo a passo
completo (sha256, `PATH`, atualização, desinstalação):
[Instalação](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/primeiros-passos/instalacao.md).

## Abrir arquivos que não são Markdown

Qualquer arquivo de texto pode ser aberto; ele é exibido como um único bloco de
código, com a linguagem inferida do nome:

```sh
md-preview data.json      # fence json
md-preview Makefile       # fence makefile
md-preview config.yaml    # fence yaml
```

`.md`, `.markdown` e `.mdc` continuam renderizados como Markdown. Arquivos
binários (imagens, PDF, compactados) e arquivos acima de 1 MiB são recusados.
O botão Raw mostra o conteúdo original do arquivo, não o fence gerado.

## Desenvolvimento

Pré-requisito: Bun 1.x (o repositório fixa `bun@1.4.3` em `packageManager`).

```sh
bun install
bun run build                      # cliente do navegador + binário único
./bin/md-preview notas.md --open-browser
```

O build gera `dist/client` e o embute em `bin/md-preview`. Como o cliente vai
dentro do executável, editar `src/ui/` exige um novo `bun run build` antes de
testar; `bun run build:client` gera só o cliente em `dist/client`. Não há modo
watch: o ciclo é editar, rebuildar e rodar o binário.

| Comando                | O que faz                                         |
| ---------------------- | ------------------------------------------------- |
| `bun run build`        | Compila o cliente e o binário `bin/md-preview`    |
| `bun run build:client` | Compila só o cliente do navegador (`dist/client`) |
| `bun run typecheck`    | Checa `tsconfig.json` e `tsconfig.ui.json`        |
| `bun test`             | Roda os testes de unidade e integração            |

### Onde está o código

```tree
src/
  application/cli/      # entrypoint, subcomandos, cliente do daemon, abertura do navegador
  application/daemon/   # Bun.serve, rotas SSE, watch de arquivos, imagens, assets
  core/                 # renderização (markdown-it, Shiki), config, temas, estado
  ui/                   # index.html, islands, services e estilos do cliente
  shared/               # utilitários usados pelo servidor e pelo cliente
tests/                  # testes de unidade e integração
build.ts                # build do cliente e do binário
```

A renderização de página fica em `src/core/page.ts`, o servidor em
`src/application/daemon/` e a interface em `src/ui/index.html` +
`src/ui/islands/`. O daemon sobe sob demanda na primeira invocação da CLI e
encerra após 15 minutos ocioso.

## Documentação

A documentação de usuário é o site Docusaurus em
[`md-preview-docs/docs`](https://github.com/jrmmendes/md-preview-docs/tree/main/docs)
(pt-BR). Guias principais:

- [Markdown suportado](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/recursos/markdown.md)
  — sintaxe, tabelas, diff, Mermaid, tree fences, imagens relativas.
- [Interface](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/recursos/interface.md)
  — layout, sumário, histórico Recent, fontes, modo zen, modal de configurações.
- [Referência da CLI](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/referencia/cli.md)
  — comandos, opções e códigos de saída.
- [Criar tema](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/receitas/criar-tema.md)
  — `theme.json`, seed dos temas embutidos, override e importação pelo modal.
- [Temas Shiki](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/referencia/temas-shiki.md)
  — catálogo de 65 temas, formato `.shiki.json` e importação pelo modal.
- [Temas Mermaid](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/referencia/temas-mermaid.md)
  — formato `.mermaid.json`, variáveis e resolução no render.
- [FAQ](https://github.com/jrmmendes/md-preview-docs/blob/main/docs/faq.md)
  — respostas curtas e o que a ferramenta não faz.
