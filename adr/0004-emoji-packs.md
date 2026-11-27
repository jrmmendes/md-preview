# ADR 0004: emoji packs as files, selected per browser

- Status: accepted
- Date: 2026-11-27

## Context

`:shortcode:` expansion existed only through a hardcoded table. Users wanted
GitHub-compatible shortcodes plus their own glyphs/SVGs without editing the
binary or a global theme. The renderer is server-side and content-addressed, so
a pack change has to invalidate the Markdown renderer cache.

## Decision

1. **One contract, versioned.** A pack is an `emoji.json` with
   `schemaVersion: 1`, a slug `name`, an optional `style`, and a `shortcodes`
   map. `src/core/emoji/validate.ts` is authoritative; the JSON Schema is
   documentation only.
2. **Builtin embedded, user packs on disk.** `emojis/github.json` is imported
   statically and packed into the binary. User packs live in
   `<configDir>/emojis/<slug>.json`; a user file with a builtin slug overrides
   the builtin, while the import endpoint rejects builtin/duplicate slugs with
   `409`. Seeding (`emoji seed`) is optional and never overwrites.
3. **Assets stay next to the pack.** Non-native styles resolve
   `<configDir>/emojis/assets/<slug>/<shortcode>.svg` through a read-only route.
   Missing/unreadable assets fall back to the Unicode value, so a partially
   uploaded asset directory degrades instead of breaking the page.
4. **Selection is layered, never persisted in the document.** Precedence is
   `?emoji=` > `mdprv_emoji` cookie > `config.json`/`MDPRV_EMOJI` > `github`.
   The modal keeps the choice in its draft and writes the cookie only on Save,
   mirroring `mdprv_theme`; an explicit `?emoji=` is removed on save so the
   cookie wins after the reload.
5. **Import is additive.** `POST /__emojis` streams a single JSON body (256 KiB
   cap), validates, writes atomically with `link` (no overwrite) and refreshes
   the store. Importing does not select the pack.
6. **Preview data is lazy.** The page payload carries only the catalog
   (`emojis`) and the effective slug (`emoji`). The settings grid fetches
   `GET /__emoji-samples/<pack>` on demand, which returns at most 24 samples
   and skips oversized inline data URIs. This keeps every rendered document
   small while still showing real glyphs before Save.
7. **Live catalog, stable UI.** `GET /__emojis` participates in the settings
   catalog sync and the SSE `emojis` event refreshes the list in place. Changing
   the selection repaints radios and the preview only; no page re-render, so
   typed JSON and scroll stay put. The document itself reloads only when the
   effective pack was edited on disk.

## Alternatives considered

- **Store packs inside `config.json`.** Rejected: one file per pack matches the
  theme model, keeps atomic writes simple and allows assets beside the JSON.
- **Fetch Twemoji/Noto from a CDN.** Rejected: the daemon is local-first and the
  CSP allows images, not arbitrary code; packs must work offline.
- **Embed all shortcodes in the page payload.** Rejected: pages would grow with
  every pack (and inline SVG data URIs can be large) even when the modal is
  never opened.
- **Apply the imported pack immediately.** Rejected: import is a file operation;
  applying changes the whole document and must follow the explicit Save flow.
- **Per-document `emoji` frontmatter.** Deferred: it would add a second
  selection channel and make live reload harder to reason about.

## Consequences

- Shortcode samples and the settings grid share the renderer's visual rule:
  inline SVG first, pack asset second (with Unicode fallback), native glyph
  last.
- The renderer cache key includes the pack id (style + shortcode table), so
  edits invalidate only affected pages.
- `GET /__emoji-samples/<pack>` is a read-only, same-origin UI helper. It is
  additive and does not change the CLI or the pack contract.
- Invalid user packs are reported and ignored; a deleted pack never breaks a
  page because resolution falls through the precedence list.
