# Tema Tropical

Coleção de temas prontos em tons terrosos e quentes (ivory, coral, clay, kraft,
céu e oliva): um par claro e escuro que cobre as três camadas do md-preview.

| Arquivo | Tipo | Slug | Papel |
| --- | --- | --- | --- |
| `tropical.json` | tema de cores | `tropical` | Página clara completa |
| `tropical-dark.json` | tema de cores | `tropical-dark` | Página escura completa |
| `tropical.shiki.json` | Shiki | `tropical` | Realce de código claro |
| `tropical-dark.shiki.json` | Shiki | `tropical-dark` | Realce de código escuro |
| `tropical.mermaid.json` | Mermaid | `tropical` | Diagramas claros |
| `tropical-dark.mermaid.json` | Mermaid | `tropical-dark` | Diagramas escuros |

Os temas de cores já apontam para os slugs `tropical` / `tropical-dark` nos
blocos Código e Gráficos. Instale os seis arquivos para ter o conjunto completo;
sem os temas Shiki/Mermaid, o app cai nos fallbacks (`github-light`,
`github-dark` e `default`) e avisa no stderr.

## Instalar

Copie os seis JSON para o diretório de temas do usuário:

```sh
themes=$(md-preview theme path | sed -n 's/^themes: //p')
cp themes/tropical/*.json "$themes/"
```

Ou, se preferir sem a CLI, o caminho padrão é
`~/.config/md-preview/themes/` (`$MDPRV_CONFIG_DIR/themes/` quando
`MDPRV_CONFIG_DIR` está definido). O daemon observa o diretório e atualiza os
catálogos sem reiniciar.

Depois escolha **Tropical** no seletor de temas; em **Aparência → Código**
use `tropical` no card Claro e `tropical-dark` no card Escuro; em
**Aparência → Gráficos** use os mesmos slugs nos cards correspondentes.

## Importar pelo modal

Abra **Temas → Importar** (`Ctrl+,`) e importe um arquivo por vez:

1. **Tema de cores:** `tropical.json` e `tropical-dark.json`.
2. **Tema Shiki:** `tropical.shiki.json` e `tropical-dark.shiki.json`.
3. **Tema Mermaid:** `tropical.mermaid.json` e `tropical-dark.mermaid.json`.

O importador usa o `name` do arquivo como slug e nunca sobrescreve um arquivo
existente. O nome do arquivo e o campo `name` precisam coincidir — renomear
qualquer um dos JSON quebra a validação.

## Validar

```sh
bun run src/application/cli/index.ts theme validate themes/tropical/tropical.json
bun run src/application/cli/index.ts theme validate themes/tropical/tropical-dark.json
```

Os wrappers Shiki/Mermaid são validados pelos mesmos `validateShikiCustom` e
`validateMermaidCustom` usados pelo daemon; o teste
`tests/theme-collection.test.ts` cobre os seis arquivos.

## Paleta

Tons terrosos e quentes (ivory, coral, clay, kraft, céu e oliva), com ajustes
de contraste para os tokens do md-preview. As fontes declaradas no `stack` são
apenas nomes com fallback local — nada é embutido.
