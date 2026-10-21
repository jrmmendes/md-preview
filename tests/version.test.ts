import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { VERSION } from "../src/core/version";

describe("VERSION", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      version?: string;
    };
    expect(VERSION).toBe(pkg.version!);
  });
});
