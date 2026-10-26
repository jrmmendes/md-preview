import { Command } from "commander";

import { preview, previewPipe } from "./commands/preview";
import { register } from "./commands/register";
import { daemonStart, daemonStatus, daemonStop } from "./commands/daemon";
import { serve } from "./commands/serve";
import { configInit } from "./commands/config";
import { themeList, themePath, themeSeed, themeValidate } from "./commands/theme";
import { VERSION } from "../../core/version";

function fail(message: string): never {
  process.stderr.write(`md-preview: ${message}\n`);
  process.exit(1);
}

const program = new Command();

program
  .name("md-preview")
  .description("Register Markdown files in a local preview daemon")
  .version(VERSION)
  .argument("[files...]", "Markdown files (.md, .markdown or .mdc)")
  .option("--theme <name>", "theme for this preview")
  .option("--open-browser", "open the first file in the default browser after registering")
  .option("--pipe", "read Markdown from stdin and register it as a temporary file")
  .action(
    async (
      files: string[] = [],
      options: { theme?: string; openBrowser?: boolean; pipe?: boolean } = {}
    ) => {
      const previewOptions = {
        theme: options.theme,
        openBrowser: options.openBrowser === true,
      };

      if (options.pipe) {
        if (files.length > 0) {
          fail("--pipe cannot be combined with file arguments");
        }
        if (process.stdin.isTTY) {
          fail("--pipe requires piped stdin (received a TTY)");
        }
        const content = await Bun.stdin.text();
        await previewPipe(content, previewOptions);
        return;
      }

      if (files.length === 0) {
        fail("missing file argument (or use --pipe)");
      }
      await preview(files, previewOptions);
    }
  );

const daemon = program.command("daemon").description("Manage the preview daemon");
daemon
  .command("start")
  .description("Start the preview daemon")
  .action(async () => {
    await daemonStart();
  });
daemon
  .command("stop")
  .description("Stop the preview daemon")
  .action(async () => {
    await daemonStop();
  });
daemon
  .command("status")
  .description("Show the preview daemon status")
  .action(async () => {
    const running = await daemonStatus();
    if (!running) {
      process.exitCode = 1;
    }
  });

const theme = program.command("theme").description("Inspect and validate themes");
theme
  .command("list")
  .description("List builtin and user themes")
  .option("--json", "print JSON")
  .action(async (options: { json?: boolean }) => {
    await themeList(options);
  });
theme
  .command("validate")
  .description("Validate a theme.json file")
  .argument("<file>", "theme JSON file")
  .action(async (file: string) => {
    if (!(await themeValidate(file))) {
      process.exitCode = 1;
    }
  });
theme
  .command("path")
  .description("Print the configuration and theme directories")
  .action(async () => {
    await themePath();
  });
theme
  .command("seed")
  .description("Create the themes directory and seed missing builtin themes")
  .action(async () => {
    await themeSeed();
  });

const config = program.command("config").description("Manage the configuration file");
config
  .command("init")
  .description("Create config.json with defaults if it does not exist")
  .action(async () => {
    await configInit();
  });

program
  .command("register")
  .description("Register a document from stdin without opening a browser")
  .requiredOption("--slug <slug>", "slug used in the preview URL")
  .option("--path <file>", "document path (enables live reload and relative images)")
  .option("--stdin", "read the Markdown content from stdin (required)")
  .action(async (options: { slug: string; path?: string; stdin?: boolean }) => {
    if (!options.stdin) {
      fail("register requires --stdin");
    }
    if (process.stdin.isTTY) {
      fail("register requires piped stdin (received a TTY)");
    }
    const content = await Bun.stdin.text();
    const finalSlug = await register({ slug: options.slug, path: options.path, content });
    process.stdout.write(finalSlug + "\n");
  });

program
  .command("__serve", { hidden: true })
  .action(() => {
    serve();
  });

try {
  await program.parseAsync(process.argv);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
