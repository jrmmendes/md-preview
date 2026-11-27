import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { configIconsDir, loadConfig, type Config } from "../../../core/config";
import { createIconStore } from "../../../core/icons/store";
import { seedIconPacks } from "../../../core/icons/seed";
import { validateIconPack } from "../../../core/icons/validate";

function openStore(config: Config) {
  return createIconStore({
    dir: configIconsDir(config),
    watch: false,
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
}

export async function iconList(
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
    process.stdout.write(`${item.name}\t${item.source}\t${item.style}\t${item.count}\n`);
  }
  for (const error of store.errors()) {
    process.stderr.write(`md-preview: invalid icon pack ${error.file}: ${error.message}\n`);
  }
}

export async function iconPath(config: Config = loadConfig()): Promise<void> {
  const dir = configIconsDir(config);
  process.stdout.write(`config: ${config.configDir}\n`);
  process.stdout.write(`icons: ${dir}\n`);
  process.stdout.write(`assets: ${dir}\n`);
}

export async function iconValidate(file: string): Promise<boolean> {
  const name = basename(file).replace(/\.json$/i, "");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    process.stderr.write(
      `md-preview: invalid icon pack ${file}: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return false;
  }
  try {
    validateIconPack(name, raw);
    process.stdout.write(`ok: ${file}\n`);
    return true;
  } catch (err) {
    process.stderr.write(`md-preview: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
}

export async function iconSeed(config: Config = loadConfig()): Promise<void> {
  const result = seedIconPacks({
    dir: configIconsDir(config),
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
  process.stdout.write(`created: ${result.created.length}\n`);
  process.stdout.write(`skipped: ${result.skipped.length}\n`);
  for (const error of result.errors) {
    process.stderr.write(`md-preview: ${error.file}: ${error.message}\n`);
  }
}
