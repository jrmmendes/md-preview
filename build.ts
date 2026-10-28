import { mkdirSync, rmSync } from "node:fs";

mkdirSync("bin", { recursive: true });
rmSync("dist/client", { recursive: true, force: true });

const args = process.argv.slice(2);
const clientOnly = args.includes("--client-only");
const dev = args.includes("--dev");

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline !== undefined) {
    return inline.slice(prefix.length);
  }
  const index = args.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

// Defaults keep the local build bit-for-bit identical to the previous behavior.
// The release workflow overrides these to cross-compile (see .github/workflows/release.yml).
const buildTarget = (readOption("target") ?? process.env.MD_PREVIEW_BUILD_TARGET ?? "bun") as
  | "bun"
  | Bun.Build.CompileTarget;
const outfile = readOption("outfile") ?? process.env.MD_PREVIEW_BUILD_OUTFILE ?? "bin/md-preview";

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
  compile: {
    outfile,
    ...(buildTarget === "bun" ? {} : { target: buildTarget }),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`built ${outfile}`);
