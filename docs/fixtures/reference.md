---
title: Referência md-preview
date: 2026-10-21
tags:
  - fixture
  - baseline
  - mermaid
author:
  name: Equipe md-preview
  role: maintainer
---

# Referência de preview

Parágrafo de abertura com **negrito**, *itálico*, `código inline` e um [link](https://example.com).
Também há ~~texto removido~~ para cobrir o GFM.

## Seção com tabela e tarefas

- [x] Frontmatter com metadados
- [ ] Validar o baseline visual
- [ ] Repetir os cenários depois da refatoração

| Coluna | Tipo | Exemplo |
| --- | --- | --- |
| `title` | string | Referência md-preview |
| `tags` | array | fixture, baseline |
| `author` | objeto | name, role |

### Subseção com código

```ts
interface PreviewInput {
  title: string;
  body: string;
  themeName: string;
}

export function previewLabel(input: PreviewInput): string {
  return `${input.title} (${input.themeName})`;
}
```

Bloco sem linguagem:

```
texto simples
  com indentação preservada
```

Imagem local:

![Foto de referência](img/foto.png)

Nota de rodapé com referência.[^1]

## Diagramas Mermaid

```mermaid
flowchart LR
  A[Markdown] --> B[HTML]
  B --> C{Tema}
  C -->|claro| D[Shiki light]
  C -->|escuro| E[Shiki dark]
```

```mermaid
architecture-beta
    group api(cloud)[API]

    service db(database)[Database] in api
    service disk1(disk)[Storage] in api
    service disk2(disk)[Storage] in api
    service server(server)[Server] in api

    db:L -- R:server
    disk1:T -- B:server
    disk2:T -- B:server
```

[^1]: Texto da nota de rodapé usado na fixture de referência.
