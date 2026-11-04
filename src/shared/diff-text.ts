/**
 * Clipboard text for a diff block.
 *
 * Shared by the server renderer's `diffPlainText` helper (unit-tested) and the
 * client island, which reads the same kinds/text from the inline pane. Context
 * lines keep a single leading space, matching unified diff output; hunk and
 * metadata rows carry no code and are dropped.
 */

export type DiffTextKind = "context" | "add" | "del" | "meta" | "hunk";

export interface DiffTextLine {
  kind: DiffTextKind;
  text: string;
}

function prefixFor(kind: DiffTextKind): "+" | "-" | " " | null {
  if (kind === "add") {
    return "+";
  }
  if (kind === "del") {
    return "-";
  }
  if (kind === "context") {
    return " ";
  }
  return null;
}

export function buildDiffClipboardText(lines: readonly DiffTextLine[]): string {
  const rendered: string[] = [];
  for (const line of lines) {
    const prefix = prefixFor(line.kind);
    if (prefix !== null) {
      rendered.push(prefix + line.text);
    }
  }
  return rendered.join("\n");
}
