import { readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { Command } from "commander";

import {
  ensureDaemon,
  healthy,
  openInBrowser,
  pidAlive,
  registerDocument,
  shutdownDaemon,
} from "./client";
import { startDaemon } from "./daemon";
import { slugFor } from "./slug";
import { readDaemonState } from "./state";

const VERSION = "1.0.0";

function fail(message: string): never {
  process.stderr.write(`md-preview: ${message}\n`);
  process.exit(1);
}

function encodeSlug(slug: string): string {
  return slug.split("/").map(encodeURIComponent).join("/");
}

async function preview(file: string): Promise<void> {
  const abs = resolve(file);
  let isFile = false;
  try {
    isFile = statSync(abs).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) {
    fail(`not a file: ${file}`);
  }

  const ext = extname(abs).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    fail(`unsupported file extension: ${ext || "(none)"} (expected .md or .markdown)`);
  }

  const content = readFileSync(abs, "utf8");
  const slug = slugFor(abs);
  const daemon = await ensureDaemon();
  const finalSlug = await registerDocument(daemon.port, { slug, path: abs, content });
  const url = `http://127.0.0.1:${daemon.port}/${encodeSlug(finalSlug)}`;

  if (!openInBrowser(url)) {
    process.stderr.write(`md-preview: could not open a browser\n`);
  }
  console.log(url);
}

async function daemonStart(): Promise<void> {
  const state = readDaemonState();
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    console.log(`md-preview daemon already running (pid ${state.pid}, port ${state.port})`);
    return;
  }

  const port = Number(process.env.MDPRV_PORT) || 8765;
  if (await healthy(port)) {
    const pid = state?.pid ?? 0;
    console.log(`md-preview daemon already running (pid ${pid}, port ${port})`);
    return;
  }

  const started = await ensureDaemon();
  console.log(`md-preview daemon started (pid ${started.pid}, port ${started.port})`);
}

async function daemonStop(): Promise<void> {
  const result = await shutdownDaemon();
  if (result === "not-running") {
    console.log("md-preview daemon is not running");
  } else if (result === "stale") {
    console.log("md-preview daemon was not running (removed stale state)");
  } else {
    console.log("md-preview daemon stopped");
  }
}

async function daemonStatus(): Promise<void> {
  const state = readDaemonState();
  if (state && pidAlive(state.pid) && (await healthy(state.port))) {
    console.log(`md-preview daemon running (pid ${state.pid}, port ${state.port})`);
    return;
  }
  console.log("md-preview daemon stopped");
  process.exit(1);
}

const program = new Command();

program
  .name("md-preview")
  .description("Preview Markdown files in the default browser")
  .version(VERSION)
  .argument("<file>", "markdown file (.md or .markdown)")
  .action(async (file: string) => {
    await preview(file);
  });

const daemon = program.command("daemon").description("Manage the preview daemon");
daemon.command("start").description("Start the preview daemon").action(daemonStart);
daemon.command("stop").description("Stop the preview daemon").action(daemonStop);
daemon.command("status").description("Show the preview daemon status").action(daemonStatus);

program
  .command("__serve", { hidden: true })
  .action(() => {
    startDaemon();
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
