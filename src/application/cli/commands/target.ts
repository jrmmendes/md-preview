import { loadConfig, type Config } from "../../../core/config";
import { classifyPath } from "../../../core/paths";
import { previewFolder, type FolderResult } from "./folder";
import { preview, type PreviewOptions, type PreviewResult } from "./preview";

export type TargetResult = PreviewResult[] | FolderResult;

function assertFile(target: string, multiple: boolean): void {
  const kind = classifyPath(target);
  if (kind === "file") {
    return;
  }
  if (kind === "missing") {
    throw new Error(`path not found: ${target}`);
  }
  if (kind === "directory" && multiple) {
    throw new Error(`not a file: ${target} (a directory can only be previewed on its own)`);
  }
  throw new Error(`not a file: ${target}`);
}

/**
 * Preview a path given directly on the command line.
 *
 * A single directory is expanded exactly like the old `folder` command: every
 * Markdown file directly inside it is registered, `index.md` (or the first
 * name) is opened in the browser, and one `name  url` line is printed per file.
 * A file keeps the file behavior, including multiple files at once.
 *
 * A path names at most one filesystem entry, so there is no file/directory
 * ambiguity to resolve: `stat` decides (following symlinks), and a directory
 * named `notes.md` is previewed as a directory.
 */
export async function previewTarget(
  target: string | readonly string[],
  options: PreviewOptions = {},
  config: Config = loadConfig()
): Promise<TargetResult> {
  const list = typeof target === "string" ? [target] : [...target];
  if (list.length === 0) {
    throw new Error("no paths given");
  }

  if (list.length === 1) {
    const only = list[0]!;
    const kind = classifyPath(only);
    if (kind === "directory") {
      return previewFolder(
        only,
        { theme: options.theme, openBrowser: options.openBrowser, opener: options.opener, log: options.log },
        config
      );
    }
    if (kind === "missing") {
      throw new Error(`path not found: ${only}`);
    }
  }

  for (const path of list) {
    assertFile(path, list.length > 1);
  }
  return preview(list, options, config);
}
