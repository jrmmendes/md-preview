# md-preview

A Bun + TypeScript CLI that renders Markdown files in the default browser with live reload.

## Requirements

- Bun 1.x (this repo uses `bun@1.4.3`)
- Linux, macOS, or Windows (browser opening uses `xdg-open`, `open`, or `explorer.exe`)

## Setup

```sh
bun install
bun run build
```

The compiled binary is written to `bin/md-preview`. `bun run build` builds the browser client first and then embeds it in the single executable. `bun run build:client` builds only the client shell into `dist/client`.

`./build.sh` is an alternative that installs with a frozen lockfile and then builds.

## Usage

```sh
md-preview <file>          # start the daemon if needed, register the file, open it, print the URL
cat doc.md | md-preview register --stdin --slug docs/doc --path /abs/doc.md
md-preview daemon start
md-preview daemon stop
md-preview daemon status   # exit 0 when running, 1 when stopped
md-preview --version
```

Only `.md` and `.markdown` files are accepted by the root command. `register` reads Markdown from stdin (piped, not a TTY), never opens a browser, and prints only the final slug on stdout. `--path` is optional: when present it enables file watching and relative images; when absent the content from stdin is authoritative. Failures go to stderr with exit code 1.

## Configuration

| Variable                 | Default                                                    | Description                                        |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| `MDPRV_PORT`             | `8765`                                                     | Port for the local daemon                          |
| `MDPRV_IDLE`             | `15`                                                       | Idle timeout in minutes before the daemon exits    |
| `MDPRV_THEME`            | `auto`                                                     | Default theme (`auto` follows the OS color scheme) |
| `MDPRV_LOADER`           | `classic`                                                  | Page loader style                                  |
| `MDPRV_ZOOM_SENSITIVITY` | `1.1`                                                      | Zoom step multiplier                               |
| `MDPRV_STATE`            | `${XDG_STATE_HOME:-~/.local/state}/md-preview/daemon.json` | Daemon state file                                  |

## Browser state

Only the server needs the theme, so it is the only value stored in a cookie. The remaining preferences stay in browser storage; reloading clears zen mode and the open panels.

| Key                                                         | Storage        | Purpose                                  |
| ----------------------------------------------------------- | -------------- | ---------------------------------------- |
| `mdprv_theme`                                               | cookie         | Theme read by the server on each request |
| `mdprv_width`                                               | localStorage   | Content width                            |
| `mdprv_loader`                                              | localStorage   | Loader style                             |
| `mdprv_font`                                                | localStorage   | Font family                              |
| `mdprv_zoom_sensitivity`                                    | localStorage   | Mermaid zoom scroll sensitivity          |
| `mdprv_left_collapsed`, `mdprv_right_collapsed`             | localStorage   | Sidebar/history collapsed state          |
| `mdprv_loader_pending`                                      | sessionStorage | Loader shown across a theme reload       |

## Development

```sh
bun run typecheck   # tsconfig.json + tsconfig.ui.json
bun test
bun run build
```

Scripts:

| Script               | Description                                      |
| -------------------- | ------------------------------------------------ |
| `bun run build:client` | Build the browser client shell (`dist/client`) |
| `bun run build`      | Build client then the single `bin/md-preview`    |
| `bun run typecheck`  | Typecheck server/core and browser projects       |
| `bun test`           | Run the unit and integration tests               |

## Layout

```text
src/
  application/
    cli/          # commander entrypoint, commands, daemon client, browser opener
    daemon/       # Bun.serve, SSE routes, file watch, images, assets, shell
  core/
    config.ts     # single env reader + defaults
    contract.ts   # page and event types
    page.ts       # renderPage(input, shell)
    meta.ts       # frontmatter metadata card
    frontmatter.ts
    slug.ts
    state.ts
    markdown/     # markdown-it + Shiki
    themes/       # JSON catalog, tokens, CSS and Mermaid payload
  ui/
    index.html    # shell with {{mdprv-*}} tokens
    main.ts       # islands bootstrap
    prefs.ts      # the only browser storage access
    services/     # loader singleton and SSE events
    islands/      # layout, TOC, history, settings, Mermaid, copy, live reload
    styles/       # base, meta, sidebar, mermaid, loader
  types.d.ts
tests/
build.ts
build.sh
```

`bin/md-preview` remains a single distributable artifact; `dist/client` is generated at build time and is not required at runtime.
