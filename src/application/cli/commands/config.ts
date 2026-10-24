import { writeDefaultConfig } from "../../../core/config-file";
import { loadConfig, type Config } from "../../../core/config";

export async function configInit(config: Config = loadConfig()): Promise<void> {
  const result = writeDefaultConfig(config.configDir);
  process.stdout.write(
    result.created ? `created ${result.path}\n` : `already exists: ${result.path}\n`
  );
}
