import { resolve } from "node:path";

import { loadConfig, type Config } from "../../../core/config";
import { ensureDaemon, registerDocument } from "../daemon-client";

export interface RegisterInput {
  slug: string;
  path?: string;
  content: string;
}

export async function register(
  input: RegisterInput,
  config: Config = loadConfig()
): Promise<string> {
  const slug = input.slug.trim();
  if (slug === "") {
    throw new Error("--slug must not be empty");
  }

  const filePath = input.path === undefined || input.path === "" ? "" : resolve(input.path);
  const daemon = await ensureDaemon(config);
  return registerDocument(daemon.port, { slug, path: filePath, content: input.content }, daemon.token);
}
