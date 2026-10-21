import { readFileSync } from "node:fs";

import shellAsset from "../../../dist/client/index.html" with { type: "file" };

const shellPath = shellAsset as unknown as string;
let cached: string | null = null;

export function loadShell(): string {
  if (!shellPath.includes("$bunfs")) {
    return readFileSync(shellPath, "utf8");
  }
  if (cached === null) {
    cached = readFileSync(shellPath, "utf8");
  }
  return cached;
}
