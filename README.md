
<div align=center>

# md-preview

<img width="1804" height="1116" alt="image" src="https://github.com/user-attachments/assets/46cf31a6-d856-4592-b308-672c289a4966" />


A Bun + TypeScript CLI that renders Markdown files in the default browser with live reload.

</div>



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

## Tree fences

Fences tagged `tree` are rendered as an interactive directory tree instead of a
plain code block. Paste the output of `tree` (the optional `N directories, M
files` footer is understood and removed):

````markdown
```tree
meu-projeto
├── src
│   ├── index.ts
│   └── lib
│       └── util.ts
├── docs
│   └── README.md
└── package.json

3 directories, 4 files
```
````

- The root and the first level start expanded; deeper directories start collapsed,
  so there is no flash of a fully open tree.
- Click a directory (or press Enter/Space) to toggle it. Arrow keys move between
  visible rows and Left/Right collapse or expand. The toolbar offers
  **Expandir tudo** and **Recolher tudo**.
- Every directory shows the total number of descendants (`3 itens`, `1 item`).
- `tree -a` (hidden files) and `tree -d` (directories only) output is supported.
  `tree -d` is detected from the `0 files` footer, or from a `tree -d` fence info
  string when the report footer is disabled.
- If the body is not recognizable as `tree` output, the fence falls back to a
  normal code block. Names are rendered as text, never as HTML.
- The component uses only the active theme's CSS variables and has no runtime
  dependency. It works with `auto`, fixed light/dark themes and static HTML
  exports; the client script is only needed for the global buttons and keyboard
  navigation.

## Security model

The daemon is a local service, so it is hardened against other browser tabs and local web pages:

- It binds to `127.0.0.1` and rejects requests whose `Host` header is not a loopback name (`127.0.0.1`, `localhost`, `::1`). This blocks DNS-rebinding attacks.
- Requests carrying a non-loopback `Origin` are rejected with `403`.
- State-changing endpoints (`PUT /__register`, `POST /__shutdown`) require a per-daemon token. The token is generated at startup, stored in the state file with mode `0600`, and sent automatically by the CLI. Requests without it get `401`.
- Rendered pages carry a nonce-based `Content-Security-Policy`. Raw HTML in Markdown still renders, but injected `<script>` tags, inline event handlers and `javascript:` URLs are blocked. External stylesheets, frames, forms and plugins are blocked as well.
- Relative images are served only from a registered document directory, only for known image extensions, and symlinks are resolved so they cannot escape that directory.

During startup the daemon writes the `{ pid, port, token }` state file. If you delete it while the daemon is running, stop the daemon and start it again; the CLI will not talk to a daemon whose token it does not know.

## Configuration

Configuration is centralized in `${XDG_CONFIG_HOME:-~/.config}/md-preview/`:

```text
~/.config/md-preview/
  config.json
  config.schema.json
  themes/
    auto.json
    nord.json
    ...
    theme.schema.json
```

`MDPRV_CONFIG_DIR` overrides that whole directory (useful for portable installs and tests); it is not a second legacy location. `config.json` is optional and is never created implicitly. `md-preview config init` creates it (and its editor schema) without overwriting an existing file.

```json
{
  "$schema": "./config.schema.json",
  "theme": "auto",
  "port": 8766,
  "idle": 15,
  "loader": "classic",
  "zoomSensitivity": 1.1,
  "seedThemes": true
}
```

Precedence for every option is `defaults < config.json < MDPRV_*`. Invalid JSON is reported once and defaults are used; unknown keys are ignored with a warning. `?theme=` and the `mdprv_theme` cookie still select a theme per request and win over the configured theme.

| Variable                 | Default                                                    | Description                                        |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| `MDPRV_CONFIG_DIR`       | `${XDG_CONFIG_HOME:-~/.config}/md-preview`                 | Configuration root                                 |
| `MDPRV_PORT`             | `8766`                                                     | Port for the local daemon                          |
| `MDPRV_IDLE`             | `15`                                                       | Idle timeout in minutes before the daemon exits    |
| `MDPRV_THEME`            | `auto`                                                     | Default theme (`auto` follows the OS color scheme) |
| `MDPRV_LOADER`           | `classic`                                                  | Page loader style                                  |
| `MDPRV_ZOOM_SENSITIVITY` | `1.1`                                                      | Zoom step multiplier                               |
| `MDPRV_SEED_THEMES`      | `1`                                                        | Seed missing builtin themes at daemon startup      |
| `MDPRV_STATE`            | `${XDG_STATE_HOME:-~/.local/state}/md-preview/daemon.json` | Daemon state file                                  |

## Themes

Themes are `theme.json` files with `schemaVersion: 1` in `~/.config/md-preview/themes/<name>.json`. The file name is the theme name and must match `^[a-z0-9][a-z0-9-]{0,63}$`. A user theme with the same name as a builtin overrides it in memory; the builtin file and the user file are never rewritten. Delete the user file to return to the builtin.

```json
{
  "$schema": "./theme.schema.json",
  "schemaVersion": 1,
  "name": "nord",
  "kind": "dark",
  "colors": {
    "background": "#2e3440",
    "surface": "#3b4252",
    "text": "#d8dee9",
    "muted": "#7b88a1",
    "border": "#4c566a",
    "accent": "#88c0d0",
    "code-bg": "#3b4252",
    "quote": "#7b88a1"
  },
  "radii": { "sm": 5, "md": 6, "lg": 8, "xl": 12 },
  "typography": {
    "family": "system-ui",
    "stack": "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif",
    "base-size": 17
  },
  "layout": { "content-width": "46rem", "sidebar-width": "16rem" },
  "effects": { "shadow-panel": "0 8px 28px rgba(0,0,0,.28)" },
  "shiki": { "light": "nord", "dark": "nord" },
  "mermaid": { "theme": "neutral", "overrides": {} }
}
```

- Required fixed-theme colors: `background`, `surface`, `text`, `muted`, `border`, `accent`, `code-bg`, `quote`. Optional colors (`surface-raised`, `border-strong`, `accent-fg`, `link`, `code-fg`, `danger`, `warning`, `success`, `info`, `selection`) are derived from those when omitted.
- Optional groups (`radii`, `typography`, `layout`, `effects`) fall back to the documented defaults.
- `kind: "auto"` only accepts `variants.light` and `variants.dark`, resolved after the builtin/user merge.
- `shiki.light`/`shiki.dark` must be one of `github-light`, `github-dark`, `dracula`, `nord`, `solarized-dark`, `solarized-light`, `gruvbox-dark-medium`, `gruvbox-light-medium`.
- Values are validated against CSS injection and unsafe lengths; invalid files are ignored with an error and the builtin remains available.
- Editing a theme file triggers an SSE `themes` event; the tab reloads when the current theme (or `auto`) changed. There is no in-place CSS hot reload.

Builtin themes are packaged in `themes/` at the repository root and embedded in the compiled binary. On startup the daemon seeds missing files into the config directory when `seedThemes` is true; existing files are never overwritten and symlinks are ignored.

Commands:

```sh
md-preview doc.md --theme nord    # validate the theme and open with ?theme=nord
md-preview theme list [--json]    # builtin and user themes with their source
md-preview theme validate FILE    # validate one theme.json file
md-preview theme path             # print the config and themes directories
md-preview theme seed             # create themes/ and seed missing builtins
md-preview config init            # create config.json without overwriting
```

### Breaking change: legacy theme files

This release intentionally does **not** read or migrate `.md-preview`, `~/.md-preview`, `./.md-preview` or themes in the current directory.

| Previous | Now |
| --- | --- |
| `MDPRV_THEME=nord` | Keep it as a runtime override, or write `"theme": "nord"` in `config.json`. |
| Theme JSON in a legacy folder | Move it manually to `~/.config/md-preview/themes/<name>.json`. |
| Unversioned theme (`tokens`) | Convert to `schemaVersion: 1` with a `colors` object; `md-preview theme validate` reports what is missing. |

No legacy file is deleted or overwritten.

## Browser state

Only the server needs the theme, so it is the only value stored in a cookie. The remaining preferences stay in browser storage; reloading clears zen mode and the open panels.

| Key                                                         | Storage        | Purpose                                  |
| ----------------------------------------------------------- | -------------- | ---------------------------------------- |
| `mdprv_theme`                                               | cookie         | Theme read by the server on each request |
| `mdprv_width`                                               | localStorage   | Content width                            |
| `mdprv_loader`                                              | localStorage   | Loader style                             |
| `mdprv_font`                                                | localStorage   | Font selection `{ v: 1, family, source, stack }` |
| `mdprv_zoom_sensitivity`                                    | localStorage   | Mermaid zoom scroll sensitivity          |
| `mdprv_left_collapsed`, `mdprv_right_collapsed`             | localStorage   | Sidebar/history collapsed state          |
| `mdprv_loader_pending`                                      | sessionStorage | Loader intent `{ v: 1, path, ts }` for same-tab navigation/reload |

## Fonts

The browser gets the font catalog from the daemon and never enumerates local fonts from the page.

- `GET /__fonts` lists system families discovered with `fc-list` (family, aggregated styles and a best-effort category). It is `no-store`; `?refresh=1` invalidates the in-memory cache (5 minute TTL).
- If `fc-list` is missing, fails or times out, the payload has `available: false` and only the generic families (`system-ui`, `sans-serif`, `serif`, `monospace`, `cursive`, `fantasy`). The picker keeps them selectable and reports the degraded state.
- `GET /__fonts/google?family=<Family>` is an opt-in proxy: the daemon fetches the Google `css2` stylesheet, downloads only `https://fonts.gstatic.com` `.woff2` files, and rewrites `@font-face` URLs to `GET /__fonts/file/<sha256>` (immutable cache). Invalid families return `400`; upstream failures return `502`.
- The page never contacts Google directly. A saved Google selection only adds a same-origin `<link>`; the CSP stays `font-src 'self' data:`.
- `mdprv_font` stores `{ v: 1, family, source: "local"|"google", stack }`. Legacy plain strings migrate to `source: "local"` with a derived stack. Reset removes the key and `--mdprv-font`.
- The picker searches the catalog locally (diacritic-insensitive; exact > prefix > word prefix > substring > subsequence, at most 80 results), previews each family with "Aa Bb Cc 0123" and supports combobox keyboard navigation. The inline head script applies the saved stack before the body, so there is no font flash.

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
    markdown/     # markdown-it, Shiki and the tree fence
    themes/       # theme contract, store, CSS and Mermaid payload (builtins live in ../themes)
  ui/
    index.html    # shell with {{mdprv-*}} tokens
    main.ts       # islands bootstrap
    prefs.ts      # the only browser storage access
    services/     # loader, navigation, font catalog/search, SSE events
    islands/      # layout, TOC, history, settings, font picker, Mermaid, tree, copy, live reload
    styles/       # base, meta, sidebar, fonts, mermaid, tree, loader
  types.d.ts
tests/
build.ts
build.sh
```

`bin/md-preview` remains a single distributable artifact; `dist/client` is generated at build time and is not required at runtime. Builtin themes are imported statically and embedded in the binary, so `themes/` does not need to exist at runtime.

`package.json` is still `private: true`. When it becomes publishable, `files` already limits the package to `bin/`, `themes/`, `dist/client/` and `README.md`, and `prepack` runs the build so both artifacts are present.
