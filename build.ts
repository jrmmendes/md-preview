import { mkdirSync, rmSync } from "node:fs";

mkdirSync("bin", { recursive: true });
rmSync("dist/client", { recursive: true, force: true });

const args = process.argv.slice(2);
const clientOnly = args.includes("--client-only");
const dev = args.includes("--dev");

const entrypoints = ["src/ui/index.html"];
const external = ["*/mermaid.min.js"];

const client = dev
  ? await Bun.build({
      entrypoints,
      target: "browser",
      minify: false,
      outdir: "dist/client",
      external,
      publicPath: "/__assets/",
    })
  : await Bun.build({
      entrypoints,
      target: "browser",
      compile: true,
      minify: true,
      outdir: "dist/client",
      external,
    });

if (!client.success) {
  for (const log of client.logs) {
    console.error(log);
  }
  process.exit(1);
}

if (clientOnly) {
  console.log("built dist/client/index.html");
  process.exit(0);
}

const result = await Bun.build({
  entrypoints: ["src/application/cli/index.ts"],
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
