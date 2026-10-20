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

The compiled binary is written to `bin/md-preview`.

`./build.sh` is an alternative that installs with a frozen lockfile and then builds.

## Usage

```sh
md-preview <file>          # start the daemon if needed, register the file, open it, print the URL
md-preview daemon start
md-preview daemon stop
md-preview daemon status   # exit 0 when running, 1 when stopped
```

Only `.md` and `.markdown` files are accepted. Live reload uses `fs.watch` on the file plus version polling from the page.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `MDPRV_PORT` | `8765` | Port for the local daemon |
| `MDPRV_IDLE` | `15` | Idle timeout in minutes before the daemon exits |
| `MDPRV_THEME` | `auto` | Default theme (`auto` follows the OS color scheme) |
| `MDPRV_LOADER` | `classic` | Page loader style |
| `MDPRV_ZOOM_SENSITIVITY` | `1.1` | Zoom step multiplier |
| `MDPRV_STATE` | `${XDG_STATE_HOME:-~/.local/state}/md-preview/daemon.json` | Daemon state file |

## Development

```sh
bun run typecheck
bun run build
```

## Layout

- `src/cli.ts` — commander entrypoint
- `src/client.ts` — daemon lifecycle, register, open
- `src/daemon.ts` — HTTP server
- `src/state.ts` — persisted state
- `src/slug.ts` — URL slug
- `src/render.ts` — Markdown + Shiki
- `src/page.ts` — HTML shell
- `src/themes.ts` — theme definitions
- `src/frontmatter.ts` — frontmatter parsing
- `src/assets.ts` — mermaid bundle
- `build.ts` / `build.sh` — compile
