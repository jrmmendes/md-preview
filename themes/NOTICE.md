# Breeze color themes

`themes/breeze-light.json`, `themes/breeze-dark.json` and the `auto` wrapper
`themes/breeze.json` are color themes derived from the KDE Plasma Breeze color
schemes. They ship no images, fonts or other binary assets: only color values and
metrics, mapped onto the `theme.json` v1 contract.

- Upstream: Breeze color schemes — KDE contributors (Andrew Lake, Marco Martin,
  Nate Graham, Noah Davis, Neal Gompa, David Redondo, Thomas Duckworth and others)
- Files: `/usr/share/color-schemes/BreezeLight.colors` and
  `BreezeDark.colors`, active scheme `BreezeDark` in `~/.config/kdeglobals`
- Package: `plasma-workspace` 6.7.5-1.fc44 (Fedora 44), KDE Plasma 6.7.5
- License: LGPL-2.0-or-later (SPDX headers in the upstream `.colors` files)
- Typography: Noto Sans 10pt / Noto Sans Mono 10pt (`kdeglobals`), Noto Sans
  shipped by `google-noto-sans-fonts` on Fedora 44
- Corner radius: 5px, measured on Breeze's `button.svgz` (`rx="5"`)

## Token mapping

| Theme token | BreezeDark source | BreezeLight source |
| --- | --- | --- |
| `background` | Window `BackgroundNormal` `#202326` | Window `BackgroundNormal` `#EFF0F1` |
| `surface` | View `BackgroundNormal` `#141618` | View `BackgroundNormal` `#FFFFFF` |
| `surface-raised` | Button/Header/Tooltip `#292C30` | View `BackgroundAlternate` `#F7F7F7` |
| `text` | `ForegroundNormal` `#FCFCFC` | `ForegroundNormal` `#232629` |
| `muted` | `ForegroundInactive` `#A1A9B1` | `ForegroundInactive` `#707D8A` → `#626D78` |
| `accent` | Selection/Focus `#3DAEE9` | Selection/Focus `#3DAEE9` |
| `accent-fg` | Window background `#202326` | `ForegroundNormal` `#232629` |
| `link` | `ForegroundLink` `#1D99F3` | `ForegroundLink` `#2980B9` → `#226C9D` |
| `code-bg` | View `BackgroundAlternate` `#1D1F22` | View `BackgroundAlternate` `#F7F7F7` |
| `quote` | `ForegroundInactive` `#A1A9B1` | `#626D78` (same as `muted`) |
| `danger` | `ForegroundNegative` `#DA4453` → `#E0606E` | Selection `ForegroundNegative` `#B03745` |
| `warning` | `ForegroundNeutral` `#F67400` | `ForegroundNeutral` `#F67400` → `#AE4F00` |
| `success` | `ForegroundPositive` `#27AE60` | Selection `ForegroundPositive` `#176839` |
| `info` | `ForegroundLink` `#1D99F3` | link `#226C9D` |
| `selection` | Selection/Button `BackgroundAlternate` `#1E5774` | Selection `BackgroundAlternate` `#A3D4FA` |
| `border` | `rgba(161,169,177,.22)` from `ForegroundInactive` | `rgba(35,38,41,.16)` from `ForegroundNormal` |
| `border-strong` | `rgba(161,169,177,.42)` | `rgba(35,38,41,.30)` |

`surface-raised` reuses Breeze's window/button tone in the dark scheme; in the
light scheme it uses the lighter View alternate so menus and card hovers stay
distinguishable from the white content surface. The `.colors` files have no
border token, so the hairlines are alpha values over the scheme's own foreground
color rather than new hues.

## Deviations from Breeze (contrast fixes)

WCAG 2.x ratios were measured for `text/background`, `muted/background`,
`link/background`, `code-fg/code-bg`, `accent-fg/accent` and the status colors.
Only the values below were adjusted; every adjustment stays in the same hue as
the Breeze original.

| Token | Breeze | Used | Ratio on `background` | Reason |
| --- | --- | --- | --- | --- |
| `accent-fg` (both) | `#FCFCFC` / `#FFFFFF` | ink (`#202326` / `#232629`) | 6.34 / 6.11 on `#3DAEE9` | Breeze's white selection label is 2.43/2.49:1, below AA for text |
| `muted` (light) | `#707D8A` | `#626D78` | 3.69 → 4.63 | inactive foreground failed AA on the window background |
| `link` (light) | `#2980B9` | `#226C9D` | 3.77 → 4.97 | Breeze link failed AA on `#EFF0F1` |
| `danger` (dark) | `#DA4453` | `#E0606E` | 3.71 → 4.56 | red text failed AA |
| `danger` (light) | `#DA4453` | `#B03745` | 5.29 | uses Breeze's own Selection negative |
| `warning` (light) | `#F67400` | `#AE4F00` | 2.48 → 4.70 | orange text failed AA |
| `success` (light) | `#27AE60` | `#176839` | 5.98 | uses Breeze's own Selection positive |

`accent` itself stays `#3DAEE9` in both schemes, as in Breeze; as a fill it
reaches 6.34:1 (dark) and 6.11:1 (light) against `accent-fg`. The focus ring
contrast against the light background is 2.18:1, matching Breeze's own focus
color rather than a new palette entry. The same applies to the handful of
settings controls that paint `accent` as text: they match KDE's own contrast
instead of darkening the shared accent token.

## Shiki and Mermaid

No Breeze-specific syntax highlighter is bundled, so the pair closest to the
scheme is used and pinned to the theme's own polarity (a fixed light theme keeps
a light Shiki in both slots, and vice versa):

| Theme | Shiki slot | Background | `code-bg` |
| --- | --- | --- | --- |
| `breeze-dark` | `github-dark-dimmed` | `#22272E` | `#1D1F22` |
| `breeze-light` | `github-light` | `#FFFFFF` | `#F7F7F7` |

Mermaid uses the builtin `base` theme plus overrides built only from the tokens
above, so diagrams follow the Breeze palette instead of the Mermaid defaults.

No upstream file is copied into the repository; only these color values are
reproduced. `themes/tropical/` remains the step-by-step authoring example in
[docs/theme-authoring-method.md](../docs/theme-authoring-method.md).
