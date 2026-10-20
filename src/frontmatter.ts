import { parse as parseYaml } from "yaml";

export interface Frontmatter {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): Frontmatter {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split("\n");
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return { data: {}, body: content };
  }

  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === "---" || trimmed === "...") {
      end = i;
      break;
    }
  }
  if (end === -1) {
    return { data: {}, body: content };
  }

  let data: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(lines.slice(1, end).join("\n"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch {
    return { data: {}, body: content };
  }

  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return { data, body };
}
