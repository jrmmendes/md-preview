import { type Config } from "../../core/config";
import { themesDir } from "../../core/config-file";
import { createThemeStore } from "../../core/themes/store";

/** Validate a `--theme` value against builtin and user themes. */
export function validateThemeOption(theme: string, config: Config): string {
  const store = createThemeStore({
    dir: themesDir(config.configDir),
    watch: false,
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
  if (!store.has(theme)) {
    throw new Error(`unknown theme: ${theme}`);
  }
  return theme;
}
