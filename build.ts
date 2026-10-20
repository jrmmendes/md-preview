import { mkdirSync } from "node:fs";

mkdirSync("bin", { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/cli.ts"],
  target: "bun",
  minify: true,
  compile: { outfile: "bin/md-preview" },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log("built bin/md-preview");
