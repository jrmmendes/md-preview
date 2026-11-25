import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { configThemesDir, loadConfig, type Config } from "../../../core/config";
import { themesDir } from "../../../core/config-file";
import { isBuiltinShikiTheme } from "../../../core/themes/shiki-custom";
import { createShikiThemeStore } from "../../../core/themes/shiki-store";
import {
  isBuiltinMermaidThemeName,
} from "../../../core/themes/mermaid-index";
import { createMermaidThemeStore } from "../../../core/themes/mermaid-store";
import { createThemeStore } from "../../../core/themes/store";
import { seedThemes } from "../../../core/themes/seed";
import { validateTheme } from "../../../core/themes/validate";

function openStore(config: Config) {
  return createThemeStore({
    dir: themesDir(config.configDir),
    watch: false,
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
}

export async function themeList(
  options: { json?: boolean } = {},
  config: Config = loadConfig()
): Promise<void> {
  const store = openStore(config);
  const items = store.list();
  if (options.json) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }
  for (const item of items) {
    process.stdout.write(`${item.name}\t${item.source}\n`);
  }
  for (const error of store.errors()) {
    process.stderr.write(`md-preview: invalid theme ${error.file}: ${error.message}\n`);
  }
}

export async function themePath(config: Config = loadConfig()): Promise<void> {
  process.stdout.write(`config: ${config.configDir}\n`);
  process.stdout.write(`themes: ${configThemesDir(config)}\n`);
}

export async function themeValidate(
  file: string,
  config: Config = loadConfig()
): Promise<boolean> {
  const name = basename(file).replace(/\.json$/i, "");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    process.stderr.write(`md-preview: invalid theme ${file}: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
  try {
    const theme = validateTheme(name, raw);
    if (theme.kind !== "auto") {
      const store = createShikiThemeStore({
        dir: themesDir(config.configDir),
        watch: false,
        logger: { warn: (message) => process.stderr.write(`${message}\n`) },
      });
      for (const slot of [theme.shiki.light, theme.shiki.dark]) {
        if (!isBuiltinShikiTheme(slot) && !store.has(slot)) {
          process.stderr.write(
            `md-preview: warning: Shiki theme ${slot} is not builtin and was not imported on this machine; rendering falls back to github-light/github-dark\n`
          );
        }
      }
      store.close();
      const mermaid = theme.mermaid.theme;
      if (!isBuiltinMermaidThemeName(mermaid)) {
        const mermaidStore = createMermaidThemeStore({
          dir: themesDir(config.configDir),
          watch: false,
          logger: { warn: (message) => process.stderr.write(`${message}\n`) },
        });
        if (!mermaidStore.has(mermaid)) {
          process.stderr.write(
            `md-preview: warning: Mermaid theme ${mermaid} is not builtin and was not imported on this machine; rendering falls back to default\n`
          );
        }
        mermaidStore.close();
      }
    }
    process.stdout.write(`ok: ${file}\n`);
    return true;
  } catch (err) {
    process.stderr.write(`md-preview: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
}

export async function themeSeed(config: Config = loadConfig()): Promise<void> {
  const result = seedThemes({
    dir: themesDir(config.configDir),
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
  process.stdout.write(`created: ${result.created.length}\n`);
  process.stdout.write(`skipped: ${result.skipped.length}\n`);
  for (const error of result.errors) {
    process.stderr.write(`md-preview: ${error.file}: ${error.message}\n`);
  }
}
