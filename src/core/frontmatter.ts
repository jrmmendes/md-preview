import { parse as parseYaml } from "yaml";

const BOM = "\uFEFF";
const BOM_CODE = 0xfeff;
const DELIMITER = "---";
const END_DELIMITER = "...";
const LINE_BREAK = "\n";
const LEADING_NEWLINES = /^\n+/;

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

function stripBom(content: string): string {
  return content.charCodeAt(0) === BOM_CODE ? content.slice(BOM.length) : content;
}

function isDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === DELIMITER || trimmed === END_DELIMITER;
}

function isOpeningDelimiter(line: string): boolean {
  return line.trim() === DELIMITER;
}

function findFrontmatterEnd(lines: readonly string[]): number {
  for (let i = 1; i < lines.length; i += 1) {
    if (isDelimiterLine(lines[i])) {
      return i;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFrontmatterData(source: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = parseYaml(source);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function extractBody(lines: readonly string[]): string {
  return lines.join(LINE_BREAK).replace(LEADING_NEWLINES, "");
}

function withoutFrontmatter(content: string): Frontmatter {
  return { data: {}, body: content };
}

export function parseFrontmatter(content: string): Frontmatter {
  const lines = stripBom(content).split(LINE_BREAK);
  if (lines.length === 0 || !isOpeningDelimiter(lines[0])) {
    return withoutFrontmatter(content);
  }

  const end = findFrontmatterEnd(lines);
  if (end === -1) {
    return withoutFrontmatter(content);
  }

  const data = parseFrontmatterData(lines.slice(1, end).join(LINE_BREAK));
  if (data === null) {
    return withoutFrontmatter(content);
  }

  return { data, body: extractBody(lines.slice(end + 1)) };
}
