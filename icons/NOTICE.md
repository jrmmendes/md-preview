# Breeze icon subset

`icons/breeze/` is a **subset** of the Breeze icon theme, copied unchanged from
`/usr/share/icons/breeze/` (size `22`, symbolic variants when available) and
committed here so the preview works offline and from the compiled binary.

- Upstream: Breeze icon theme — KDE Visual Design Group
- Package: `breeze-icon-theme` 6.31.0-1.fc44 (Fedora 44)
- License: LGPL-3.0-or-later (see `COPYING-ICONS` in this directory)

Only the files referenced by `breeze.json` are included (39 SVGs at the time of
writing). Symlinks were dereferenced with `cp -L`; the files are otherwise
unmodified.

No `breeze-dark.json` manifest is needed: symbolic icons use `currentColor`, so
the same SVG renders correctly in light and dark themes.

`src/core/icons/builtin-assets.ts` is generated from these files by
`bun run icons:assets` so the compiled binary can serve them without reading
`icons/` from disk.

Modifications: none to the SVG contents. The `md-preview` UI applies them as
CSS masks over `currentColor`, so the original colors are not used for
rendering.
