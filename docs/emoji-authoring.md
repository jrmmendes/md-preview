# Pacotes de emojis (`emoji.json`)

**Status:** contrato v1, implementado. Fonte de verdade em
`src/core/emoji/validate.ts`; `emojis/emoji.schema.json` documenta o mesmo
formato para editores.

Um pacote de emojis mapeia shortcodes `:nome:` para um glifo. O pacote embutido
`github` cobre os shortcodes mais comuns usando o emoji nativo do sistema.

## Onde ficam os arquivos

```
<configDir>/emojis/<slug>.json          # pacotes (builtin é embutido no binário)
<configDir>/emojis/assets/<slug>/<shortcode>.svg
```

`<configDir>` é `${XDG_CONFIG_HOME:-~/.config}/md-preview` ou o valor de
`MDPRV_CONFIG_DIR`. O arquivo é um JSON por pacote; `name` precisa ser igual ao
nome do arquivo sem `.json` e casar com `^[a-z0-9][a-z0-9-]{0,63}$`.

## Formato

```json
{
  "$schema": "./emoji.schema.json",
  "schemaVersion": 1,
  "name": "meu-pacote",
  "label": "Meu pacote",
  "description": "Opcional, até 512 caracteres.",
  "style": "native",
  "license": "CC-BY-4.0",
  "attribution": "Origem dos nomes e dos glifos.",
  "shortcodes": {
    "smile": "😄",
    "foguete": "🚀",
    "logo": "data:image/svg+xml;base64,PHN2Zy8+"
  }
}
```

Campos obrigatórios: `schemaVersion` (exatamente `1`), `name` e `shortcodes`.
`label`, `description`, `style`, `license` e `attribution` são opcionais.
Chaves desconhecidas são rejeitadas para não mascarar erros de digitação.

### `style`

- `native` (padrão): mostra a sequência Unicode do JSON; assets SVG do pacote
  são ignorados.
- `twemoji` e `noto`: tentam primeiro
  `/__emoji-assets/<slug>/<shortcode>.svg` e caem no Unicode quando o asset não
  existe. O `style` não baixa nada da rede; apenas seleciona a regra visual.

### Shortcodes

- Nomes: `^[a-z0-9_+-]{2,64}$`, mais o alias de um caractere `x`.
- Valores: uma sequência Unicode de 1 a 8 code points **ou** um
  `data:image/svg+xml;base64,...` com no máximo 32 KiB decodificados.
- Máximo de 2000 shortcodes por pacote e 100 pacotes de usuário por diretório.
- Shortcode desconhecido continua literal no documento (`:nope:`).

No render, `:smile:` vira `<img class="mdprv-emoji" …>` para SVG ou o próprio
glifo Unicode; o CSS `.mdprv-emoji` apenas dimensiona a imagem.

## Seleção

Precedência, do maior para o menor:

1. `?emoji=<slug>` na URL da página;
2. cookie `mdprv_emoji` (gravado pelo modal ao **Salvar**);
3. `emoji` no `config.json` (ou `MDPRV_EMOJI`);
4. embutido `github`.

Slug desconhecido ou removido cai para o próximo da lista, então apagar um
pacote nunca quebra a página. A seleção vale por página: não há `emoji` no
frontmatter.

## Importar e remover

No modal, **Emojis → Importar pacote** aceita um JSON único de até 256 KiB
(sem multipart). Importar só grava `<slug>.json` e atualiza o catálogo; aplicar
o pacote é uma ação separada (selecionar e **Salvar**). O servidor recusa
sobrescrever um slug existente ou embutido (`409`) e valida o pack antes de
gravar de forma atômica.

A lista de pacotes mostra a origem (`Embutido`/`Usuário`), `style`, número de
shortcodes e `license`/`attribution`. Só pacotes de usuário podem ser removidos;
a remoção pede confirmação e apaga o arquivo.

## CLI

```sh
md-preview emoji list            # slug, origem, style e nº de shortcodes
md-preview emoji list --json     # catálogo completo em JSON
md-preview emoji validate meu-emoji.json
md-preview emoji path            # config, emojis e diretório de assets
md-preview emoji seed            # grava github.json + emoji.schema.json (idempotente)
```

`emoji validate` usa o nome do arquivo como slug, exatamente como o daemon.
`emoji seed` nunca sobrescreve arquivos existentes; editar o `github.json`
copiado transforma o pacote em um override de usuário.

## Limites e erros

| Limite | Valor |
| --- | --- |
| Arquivo do pacote | 256 KiB |
| Valor inline (decodificado) | 32 KiB |
| Shortcodes por pacote | 2000 |
| Pacotes de usuário | 100 |
| Code points por glifo | 8 |

Arquivos inválidos são isolados: o daemon registra o erro, ignora o pacote e
continua servindo os demais. O modal lista o catálogo válido; `POST /__emojis`
devolve `422` com a mensagem do validador.
