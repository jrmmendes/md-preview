import type { DaemonState } from "../../core/state";
import { activateDocument, type ActivateResult } from "./daemon-client";
import { openInBrowser } from "./browser";

export interface PresentOptions {
  /**
   * `undefined` (default) focuses a connected tab and only opens the browser
   * when none is connected. `true` always calls the platform opener. `false`
   * never opens anything.
   */
  openBrowser?: boolean;
  /** Injection point for tests; defaults to the real platform opener. */
  opener?: (url: string) => boolean;
  /** Injection point for tests; defaults to stderr. */
  note?: (line: string) => void;
  /** Injection point for tests; defaults to the daemon HTTP call. */
  activate?: (
    port: number,
    token: string,
    payload: { slug: string; url: string }
  ) => Promise<ActivateResult>;
}

export type PresentOutcome = "opened" | "focused" | "suppressed" | "failed";

function defaultNote(line: string): void {
  process.stderr.write(`md-preview: ${line}\n`);
}

function openWith(
  opener: (url: string) => boolean,
  url: string,
  note: (line: string) => void,
  message: string
): PresentOutcome {
  if (!opener(url)) {
    process.stderr.write(`md-preview: could not open a browser\n`);
    return "failed";
  }
  note(message);
  return "opened";
}

/**
 * Decide between reusing a connected tab and handing the URL to the platform
 * opener.
 *
 * The daemon is authoritative: it knows whether any preview tab is connected
 * and which document each tab shows. When a tab already shows the target it is
 * only asked to focus; when another document is shown it navigates in place.
 * With no connected tab the CLI opens the browser exactly as on a first run.
 */
export async function present(
  daemon: DaemonState,
  target: { slug: string; url: string },
  options: PresentOptions = {}
): Promise<PresentOutcome> {
  const note = options.note ?? defaultNote;
  const opener = options.opener ?? openInBrowser;

  if (options.openBrowser === false) {
    return "suppressed";
  }
  if (options.openBrowser === true) {
    return openWith(opener, target.url, note, "opened in browser");
  }

  const activate = options.activate ?? activateDocument;
  let outcome: ActivateResult;
  try {
    outcome = await activate(daemon.port, daemon.token, {
      slug: target.slug,
      url: target.url,
    });
  } catch {
    // No usable answer from the daemon: behave like the original flow.
    return openWith(opener, target.url, note, "opened in browser");
  }

  if (outcome.action === "focused" || outcome.action === "navigated") {
    note("focused existing tab");
    return "focused";
  }

  return openWith(
    opener,
    target.url,
    note,
    outcome.first ? "opened in browser" : "tab not connected — opened"
  );
}
