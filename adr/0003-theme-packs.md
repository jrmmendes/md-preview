# ADR 0003: `theme.json` v1 packs centralized in XDG

- Status: accepted
- Date: 2026-10-23

## Context

Themes used to be nine hardcoded JSON files under `src/core/themes/catalog/` imported at module load. They only described seven colors plus Shiki and Mermaid choices; radii, typography, spacing and effects were hardcoded in the UI CSS. There was no user theme location.

## Decision

1. **One contract, versioned.** Every theme is a `theme.json` with `schemaVersion: 1`. It carries `colors`, optional `radii`/`typography`/`layout`/`effects`, and required `shiki`/`mermaid` for fixed themes. `auto` only carries `variants`.
2. **XDG only.** User configuration lives in `${XDG_CONFIG_HOME:-~/.config}/md-preview/`: `config.json` selects the active theme, `themes/*.json` defines themes. `MDPRV_CONFIG_DIR` is a portable override for tests/installs, not a legacy path. No automatic migration from `.md-preview` paths.
3. **Builtins are packaged, not copied at runtime.** The canonical files are `themes/` at the repository root. `src/core/themes/builtin.ts` imports them statically so `Bun.build --compile` embeds them in `bin/md-preview`. Seeding is optional and idempotent.
4. **Runtime store.** A store merges builtins with user files (user wins by name), resolves `auto` after the merge, caches by `(mtime,size)`, throttles scans to 250 ms and uses `fs.watch` only as an accelerator. Invalid files are isolated and reported.
5. **Single CSS generator.** `themeCss()` is the only path that emits custom properties. It emits a single `:root` block (plus a `prefers-color-scheme` block for `auto`) covering colors, radii, typography, layout and effects. The bundled CSS uses `var(--token, fallback)` and never defines theme values in `:root`.
6. **Compatibility channels stay.** `?theme=`, the `mdprv_theme` cookie, `MDPRV_THEME` and the new `--theme` flag remain runtime selectors. The `Config` type gains `configDir` and `seedThemes`.

## Alternatives considered

- **Read `themes/` from disk at runtime instead of embedding.** Rejected: the single-binary distribution must work without the repository or `themes/` beside it.
- **Keep the seven-token catalog and layer extra keys on top.** Rejected: it duplicates the source of truth and cannot express radii/typography/layout cleanly.
- **Auto-migrate legacy theme files.** Rejected: ambiguous ownership and silent rewrites are riskier than an explicit, documented manual move.
- **Hot-reload CSS without a page reload.** Rejected for now: Shiki and Mermaid are server-rendered, so a partial CSS update would be inconsistent.

## Consequences

- Existing builtin names, colors, Shiki themes and Mermaid overrides are preserved.
- Seeded copies are ordinary user themes; editing them overrides the builtin, and deleting them restores it. A future builtin change does not update an existing seeded copy.
- Theme validation is duplicated in `themes/theme.schema.json` (editor DX) and `src/core/themes/validate.ts` (runtime truth), so both are covered by tests.
