import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { configEmojisDir, loadConfig, type Config } from "../../../core/config";
import { EMOJI_ASSETS_DIR_NAME } from "../../../core/emoji/constants";
import { createEmojiStore } from "../../../core/emoji/store";
import { seedEmojiPacks } from "../../../core/emoji/seed";
import { validateEmojiPack } from "../../../core/emoji/validate";

function openStore(config: Config) {
  return createEmojiStore({
    dir: configEmojisDir(config),
    watch: false,
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
}

export async function emojiList(
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
    process.stderr.write(`md-preview: invalid emoji pack ${error.file}: ${error.message}\n`);
  }
}

export async function emojiPath(config: Config = loadConfig()): Promise<void> {
  const dir = configEmojisDir(config);
  process.stdout.write(`config: ${config.configDir}\n`);
  process.stdout.write(`emojis: ${dir}\n`);
  process.stdout.write(`assets: ${join(dir, EMOJI_ASSETS_DIR_NAME)}\n`);
}

export async function emojiValidate(file: string): Promise<boolean> {
  const name = basename(file).replace(/\.json$/i, "");
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    process.stderr.write(
      `md-preview: invalid emoji pack ${file}: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return false;
  }
  try {
    validateEmojiPack(name, raw);
    process.stdout.write(`ok: ${file}\n`);
    return true;
  } catch (err) {
    process.stderr.write(`md-preview: ${err instanceof Error ? err.message : String(err)}\n`);
    return false;
  }
}

export async function emojiSeed(config: Config = loadConfig()): Promise<void> {
  const result = seedEmojiPacks({
    dir: configEmojisDir(config),
    logger: { warn: (message) => process.stderr.write(`${message}\n`) },
  });
  process.stdout.write(`created: ${result.created.length}\n`);
  process.stdout.write(`skipped: ${result.skipped.length}\n`);
  for (const error of result.errors) {
    process.stderr.write(`md-preview: ${error.file}: ${error.message}\n`);
  }
}
