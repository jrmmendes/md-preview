import autoRaw from "../../../themes/auto.json";
import draculaRaw from "../../../themes/dracula.json";
import githubDarkRaw from "../../../themes/github-dark.json";
import githubLightRaw from "../../../themes/github-light.json";
import gruvboxDarkRaw from "../../../themes/gruvbox-dark.json";
import gruvboxLightRaw from "../../../themes/gruvbox-light.json";
import nordRaw from "../../../themes/nord.json";
import solarizedDarkRaw from "../../../themes/solarized-dark.json";
import solarizedLightRaw from "../../../themes/solarized-light.json";
import themeSchema from "../../../themes/theme.schema.json";

import type { Theme } from "./types";
import { validateTheme } from "./validate";

export const BUNDLED_RAW: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ["auto", autoRaw],
  ["dracula", draculaRaw],
  ["github-dark", githubDarkRaw],
  ["github-light", githubLightRaw],
  ["gruvbox-dark", gruvboxDarkRaw],
  ["gruvbox-light", gruvboxLightRaw],
  ["nord", nordRaw],
  ["solarized-dark", solarizedDarkRaw],
  ["solarized-light", solarizedLightRaw],
]);

export const THEME_SCHEMA_JSON: unknown = themeSchema;

export const BUNDLED_THEMES: ReadonlyMap<string, Theme> = new Map<string, Theme>(
  [...BUNDLED_RAW].map(([name, raw]): [string, Theme] => [name, validateTheme(name, raw)])
);

export const BUILTIN_NAMES: readonly string[] = [...BUNDLED_THEMES.keys()].sort((a, b) => {
  if (a === "auto") return -1;
  if (b === "auto") return 1;
  return a.localeCompare(b);
});
