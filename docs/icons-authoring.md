# Pacotes de ícones

Pacote de ícones (schemaVersion 1): `<configDir>/icons/<slug>.json`. O `slug` é
o nome do arquivo sem `.json` e precisa casar `^[a-z0-9][a-z0-9-]{0,63}$`.
O validador de runtime (`src/core/icons/validate.ts`) é autoritativo; o
`icons/icon.schema.json` documenta o mesmo contrato para editores.

```json
{
  "schemaVersion": 1,
  "name": "meu-pacote",
  "label": "Meu pacote",
  "style": "symbolic",
  "icons": {
    "copy": "meu-pacote/copy.svg",
    "check": "data:image/svg+xml;base64,PHN2Zy8+"
  }
}
```

## Campos

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `schemaVersion` | sim | `1` |
| `name` | sim | igual ao nome do arquivo |
| `label` | não | texto seguro, até 128 caracteres |
| `description` | não | texto seguro, até 512 caracteres |
| `style` | não | `symbolic` (padrão) ou `fullcolor` |
| `icons` | sim | 1..42 chaves conhecidas |
| `license` | não | até 128 caracteres |
| `attribution` | não | até 256 caracteres |

Cada valor é um caminho relativo ao diretório `icons/` (sem `..`, sem caminho
absoluto, terminando em `.svg`) ou um
`data:image/svg+xml;base64,...` de até 32 KiB decodificados. Chave desconhecida
é erro `422`, então erros de digitação não passam em silêncio.

## Chaves

`copy`, `check`, `csv`, `filter`, `funnel`, `sort`, `pivot`, `header-row`,
`header-col`, `chart`, `fullscreen`, `chevron`, `chevron-down`, `folder`,
`file`, `close`, `settings`, `sidebar`, `history`, `top`, `zen`, `zen-exit`,
`palette`, `terminal`, `activity`, `smile`, `table`, `code`, `diff`, `layers`,
`info`, `reset`, `pencil`, `trash`, `import`, `save`, `chart-bar`, `chart-hbar`,
`chart-line`, `chart-area`, `chart-pie`, `chart-scatter`.

## Seleção e fallback

`?icons=<slug>` > cookie `mdprv_icons` > `icons` do `config.json` >
`MDPRV_ICONS` > `breeze`. Um slug inválido ou ausente cai para o próximo passo,
e um slug reservado (`breeze`/`default`) sempre resolve para o pacote embutido.
Chave ausente no pacote ativo é servida pelo pacote embutido `breeze`; se também
faltar lá, o binário usa um glifo genérico, então a interface nunca quebra.

## Pacote padrão reservado

`breeze` é o pacote padrão embutido (`DEFAULT_ICON_PACK`) e é imutável: sempre
aparece no catálogo com `"source": "builtin"` e `"default": true`, não pode ser
importado de novo (`POST /__icons` responde `409`) nem removido
(`DELETE /__icons/breeze` responde `403`). Um `breeze.json` em
`~/.config/md-preview/icons/` é **ignorado** e reportado em `errors()`/CLI como
`reserved icon pack name: breeze`; os SVGs embutidos continuam valendo. A única
exceção é a cópia idêntica ao manifesto embutido criada por `icons seed`, que é
ignorada em silêncio (não é uma tentativa de sobrescrever).

`default.json` é o formato legado (pré-`schemaVersion: 1`). Ele nunca é
carregado nem listado: aparece apenas como aviso
`unsupported legacy icon pack`, e pedir `?icons=default` resolve para o builtin.
Assim nenhum arquivo de usuário sombreia o pacote padrão nem entra na seleção.

## Assets

`/__icon-assets/<slug>/<key>.svg` serve o SVG do pacote ativo. Para pacotes
próprios o arquivo precisa ficar sob `<configDir>/icons/` (sem symlink, sem
`..`). O pacote embutido é lido de `icons/breeze/` em desenvolvimento e de
`src/core/icons/builtin-assets.ts` no binário compilado. Depois de mudar
`icons/*.json` ou seus SVGs, rode `bun run icons:assets`.

## CLI

```sh
md-preview icons list [--json]
md-preview icons validate <arquivo.json>
md-preview icons path
md-preview icons seed
```

`icons seed` cria `icons/breeze.json` e `icons/icon.schema.json` em
`~/.config/md-preview/` sem sobrescrever nada. Os SVGs do pacote embutido
continuam no binário.

## Importar pelo painel

Abra **Configurações → Ícones**. A página lista os pacotes instalados (com
`style`, número de ícones, origem e `license`/`attribution`) e marca `breeze`
como **padrão**; pacotes embutidos não têm ação de remoção. A prévia mostra os
42 nomes de `ICON_KEYS` já com o pacote selecionado e herda a cor do tema.

Para importar, cole um `icon.json` (ou escolha o arquivo) no formulário e clique
em **Importar**: o mesmo JSON de até 256 KiB, com `content-type:
application/json`. O painel envia `POST /__icons` e o servidor responde
`201 { icon, icons, errors }`; `409` significa nome reservado/duplicado, `413`
arquivo grande demais, `415` envio que não é JSON e `422` pacote inválido. A
importação **só adiciona ao catálogo** e não apaga o formulário.

Aplicar é uma ação separada: selecione o pacote na lista e clique em **Salvar**.
O cookie `mdprv_icons` é gravado nesse momento (e um `?icons=` explícito é
removido da URL); como as URLs de máscara são emitidas com a página, a troca
recarrega o preview uma vez. Para remover um pacote de usuário, use a lixeira
dentro do card e confirme; `breeze` é imutável (`DELETE /__icons/breeze`
responde `403`).

## Licença dos assets embutidos

O subconjunto Breeze é LGPL-3.0-or-later; veja `icons/COPYING-ICONS` e
`icons/NOTICE.md`.
