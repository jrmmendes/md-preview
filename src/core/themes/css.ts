import type { FixedTheme, ResolvedTheme, ThemeColors } from "./types";

const COLOR_VARS: Array<[keyof ThemeColors, string]> = [
  ["background", "--mdprv-bg"],
  ["surface", "--mdprv-surface"],
  ["surface-raised", "--mdprv-surface-raised"],
  ["text", "--mdprv-fg"],
  ["muted", "--mdprv-muted"],
  ["border", "--mdprv-border"],
  ["border-strong", "--mdprv-border-strong"],
  ["accent", "--mdprv-accent"],
  ["accent-fg", "--mdprv-accent-fg"],
  ["link", "--mdprv-link"],
  ["code-bg", "--mdprv-code-bg"],
  ["code-fg", "--mdprv-code-fg"],
  ["quote", "--mdprv-quote"],
  ["danger", "--mdprv-danger"],
  ["warning", "--mdprv-warning"],
  ["success", "--mdprv-success"],
  ["info", "--mdprv-info"],
  ["selection", "--mdprv-selection"],
];

function fixedCss(theme: FixedTheme, scheme: string): string {
  const vars: string[] = [];
  for (const [key, name] of COLOR_VARS) {
    vars.push(`${name}:${theme.colors[key]}`);
  }
  for (const [key, value] of Object.entries(theme.radii)) {
    vars.push(`--mdprv-radius-${key}:${value}px`);
  }
  vars.push(`--mdprv-font-family:${theme.typography.family}`);
  vars.push(`--mdprv-font-stack:${theme.typography.stack}`);
  vars.push(`--mdprv-font-mono:${theme.typography["mono-stack"]}`);
  vars.push(`--mdprv-font-size:${theme.typography["base-size"]}px`);
  vars.push(`--mdprv-font-size-ui:${theme.typography["ui-size"]}px`);
  vars.push(`--mdprv-font-size-small:${theme.typography["small-size"]}px`);
  vars.push(`--mdprv-line-height:${theme.typography["line-height"]}`);
  vars.push(`--mdprv-heading-line-height:${theme.typography["heading-line-height"]}`);
  vars.push(`--mdprv-code-line-height:${theme.typography["code-line-height"]}`);
  vars.push(`--mdprv-font-weight:${theme.typography["weight-normal"]}`);
  vars.push(`--mdprv-font-weight-bold:${theme.typography["weight-bold"]}`);
  for (const [key, value] of Object.entries(theme.layout)) {
    vars.push(`--mdprv-${key}:${value}`);
  }
  for (const [key, value] of Object.entries(theme.effects)) {
    vars.push(`--mdprv-${key}:${value}`);
  }
  theme.charts.palette.forEach((color, index) => {
    vars.push(`--mdprv-chart-${index + 1}:${color}`);
  });
  vars.push(`color-scheme:${scheme}`);
  return vars.join(";");
}

export function tokenCss(theme: FixedTheme): string {
  return fixedCss(theme, theme.kind);
}

/**
 * Emits the theme tokens as two selectable blocks instead of a media query.
 *
 * `auto` uses the light block as the base and only applies the dark block when
 * the shell (or the modal) sets `html[data-scheme="dark"]`. This keeps custom
 * `shiki.light`/`shiki.dark` tied to the *effective* scheme, including inside
 * fixed themes where `prefers-color-scheme` must not decide anything.
 */
export function themeCss(theme: ResolvedTheme): string {
  const light = `:root{${fixedCss(theme.light, theme.kind === "auto" ? "light" : theme.kind)}}`;
  if (theme.kind !== "auto") {
    return light;
  }
  const dark = `html[data-scheme="dark"]{${fixedCss(theme.dark, "dark")}}`;
  return [light, dark].join("\n");
}
