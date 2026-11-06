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

  it("renders tree fences as an interactive tree", async () => {
    const html = await renderMarkdown(
      "```tree\nprojeto\n├── src\n│   └── index.ts\n└── README.md\n\n1 directory, 2 files\n```\n",
      "auto",
      "doc"
    );
    expect(html).toContain('class="mdprv-tree"');
    expect(html).toContain("data-mdprv-tree");
    expect(html).toContain("index.ts");
    expect(html).not.toContain("language-tree");
  }, 30000);

  it("renders a tree fence without a report footer", async () => {
    const html = await renderMarkdown(
      "```tree\nprojeto\n├── src\n│\u00a0\u00a0 └── index.ts\n└── README.md\n```\n",
      "auto",
      "doc"
    );
    expect(html).toContain('class="mdprv-tree"');
    expect(html).toContain("data-mdprv-tree");
    expect(html).toContain("index.ts");
    expect(html).not.toContain("language-tree");
  }, 30000);

  it("falls back to a plain code block for invalid tree fences", async () => {
    const html = await renderMarkdown("```tree\nnot a tree\njust text\n```\n", "auto", "doc");
    expect(html).toContain('<pre><code class="language-tree">');
    expect(html).not.toContain("mdprv-tree");
  }, 30000);

  it("accepts a -d hint in the tree fence info", async () => {
    const html = await renderMarkdown("```tree -d\n.\n├── src\n└── tests\n```\n", "auto", "doc");
    expect(html).toContain("mdprv-tree-icon--dir");
    expect(html).not.toContain("mdprv-tree-icon--file");
  }, 30000);

  it("leaves other fences untouched", async () => {
    const html = await renderMarkdown("```text\nhello\n```\n", "auto", "doc");
    expect(html).toContain('<pre><code class="language-text">');
    expect(html).not.toContain("mdprv-tree");
  }, 30000);

  const highlightCases: Array<{ lang: string; code: string }> = [
    { lang: "rust", code: 'fn main() { println!("hi"); }' },
    { lang: "go", code: "package main\nfunc main() {}" },
    { lang: "yaml", code: "name: md-preview\nversion: 1" },
    { lang: "tsx", code: "const App = () => <div />;" },
    { lang: "jsx", code: "const App = () => <div />;" },
    { lang: "sql", code: "SELECT 1;" },
    { lang: "xml", code: "<root><item /></root>" },
  ];

  for (const { lang, code } of highlightCases) {
    it(`highlights ${lang} fences`, async () => {
      const html = await renderMarkdown("```" + lang + "\n" + code + "\n```\n", "auto", "doc");
      expect(html).toContain('class="shiki');
      expect(html).not.toContain(`<pre><code class="language-${lang}">`);
    }, 30000);
  }

  it("resolves the yml alias to yaml", async () => {
    const html = await renderMarkdown("```yml\nname: md-preview\n```\n", "auto", "doc");
    expect(html).toContain('class="shiki');
    expect(html).not.toContain('<pre><code class="language-yml">');
  }, 30000);

  it("warmup is idempotent", async () => {
    await warmup();
    await warmup();
  }, 30000);

  it("rewrites sibling document links through the resolver", async () => {
    const html = await renderMarkdown(
      [
        "[registered](exists.md)",
        "[pending](new.md?x=1#sec)",
        "[missing](gone.md#later)",
        "[sub](sub/other.md)",
        "[external](https://example.com/x.md)",
        "[anchor](#local)",
        "",
      ].join("\n\n"),
      "auto",
      "docs/a",
      {
        docLinkResolver: (href) => {
          if (href === "exists.md") {
            return { href: "/docs/exists", state: "registered" };
          }
          if (href === "new.md?x=1#sec") {
            return { href: "/__doc?from=docs%2Fa&rel=new.md%3Fx%3D1%23sec", state: "pending" };
          }
          if (href.startsWith("gone.md")) {
            return { href, state: "missing" };
          }
          return null;
        },
      }
    );

    expect(html).toContain('href="/docs/exists"');
    expect(html).toContain('href="/__doc?from=docs%2Fa&amp;rel=new.md%3Fx%3D1%23sec"');
    expect(html).toContain('data-mdprv-doc-resolve="1"');
    expect(html).toContain('href="gone.md#later"');
    expect(html).toContain('data-mdprv-doc-missing="1"');
    expect(html).toContain('title="Document not found"');
    expect(html).toContain('href="sub/other.md"');
    expect(html).toContain('href="https://example.com/x.md"');
    expect(html).toContain('href="#local"');
  }, 30000);

  it("does not rewrite raw HTML links", async () => {
    const html = await renderMarkdown(
      '<a href="other.md">raw</a>\n',
      "auto",
      "docs/a",
      { docLinkResolver: (href) => ({ href: "/should-not-use", state: "registered" }) }
    );
    expect(html).toContain('href="other.md"');
    expect(html).not.toContain("/should-not-use");
  }, 30000);
});
