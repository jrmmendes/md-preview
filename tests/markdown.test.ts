import { describe, expect, it } from "bun:test";

import { normalizeContent, renderMarkdown, warmup } from "../src/core/markdown/render";

const SAMPLE = `# Título

| A | B |
| - | - |
| 1 | 2 |

- [x] feito
- [ ] pendente

~~riscado~~

Uma nota.[^1]

![foto](img/foto.png)

\`\`\`ts
const answer: number = 42;
\`\`\`

\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`

[^1]: Texto da nota.
`;

describe("normalizeContent", () => {
  it("adds a trailing newline only when missing", () => {
    expect(normalizeContent("abc")).toBe("abc\n");
    expect(normalizeContent("abc\n")).toBe("abc\n");
    expect(normalizeContent("")).toBe("");
  });
});

describe("renderMarkdown", () => {
  it("renders GFM, footnotes, relative images and Mermaid fences", async () => {
    const html = await renderMarkdown(normalizeContent(SAMPLE), "auto", "docs/fixtures/reference");
    expect(html).toContain("<table>");
    expect(html).toContain('<input class="task-list-item-checkbox"');
    expect(html).toContain("<s>riscado</s>");
    expect(html).toContain('class="footnotes"');
    expect(html).toContain('src="/img/docs/fixtures/reference/img/foto.png"');
    expect(html).toContain('<pre class="mermaid">');
    expect(html).not.toContain("language-mermaid");
  }, 30000);

  it("highlights TypeScript with the dual Shiki theme for auto", async () => {
    const html = await renderMarkdown("```ts\nconst answer: number = 42;\n```\n", "auto", "doc");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
  }, 30000);

  it("highlights a fixed theme with its own Shiki theme", async () => {
    const html = await renderMarkdown("```ts\nconst answer: number = 42;\n```\n", "nord", "doc");
    expect(html).toContain('class="shiki');
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
  }, 30000);

  it("warmup is idempotent", async () => {
    await warmup();
    await warmup();
  }, 30000);
});
