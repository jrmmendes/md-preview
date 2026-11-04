import { describe, expect, it } from "bun:test";

import {
  pairDiffRows,
  parseUnifiedDiff,
  renderDiff,
} from "../src/core/markdown/diff";
import { renderMarkdown } from "../src/core/markdown/render";

const SAMPLE = `diff --git a/src/app.ts b/src/app.ts
index 1234567..89abcde 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,4 @@
 import { x } from "./x";
-const answer = 41;
+const answer = 42;
 export default answer;
`;

describe("parseUnifiedDiff", () => {
  it("classifies lines and numbers them from hunk headers", () => {
    const lines = parseUnifiedDiff(SAMPLE);
    expect(lines).not.toBeNull();
    if (!lines) {
      return;
    }

    const kinds = lines.map((line) => line.kind);
    expect(kinds.slice(0, 4)).toEqual(["meta", "meta", "meta", "meta"]);
    expect(kinds[4]).toBe("hunk");

    const context = lines[5];
    expect(context.kind).toBe("context");
    expect(context.text).toBe('import { x } from "./x";');
    expect(context.oldNumber).toBe(1);
    expect(context.newNumber).toBe(1);

    const deletion = lines[6];
    expect(deletion.kind).toBe("del");
    expect(deletion.text).toBe("const answer = 41;");
    expect(deletion.oldNumber).toBe(2);
    expect(deletion.newNumber).toBeNull();

    const addition = lines[7];
    expect(addition.kind).toBe("add");
    expect(addition.text).toBe("const answer = 42;");
    expect(addition.oldNumber).toBeNull();
    expect(addition.newNumber).toBe(2);

    const tail = lines[8];
    expect(tail.kind).toBe("context");
    expect(tail.oldNumber).toBe(3);
    expect(tail.newNumber).toBe(3);
  });

  it("treats the no-newline marker as meta and keeps counters", () => {
    const lines = parseUnifiedDiff(
      "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n"
    );
    expect(lines).not.toBeNull();
    if (!lines) {
      return;
    }
    expect(lines.map((line) => line.kind)).toEqual(["hunk", "del", "meta", "add"]);
  });

  it("accepts fences with only +/- lines", () => {
    const lines = parseUnifiedDiff("-old\n+new\n");
    expect(lines).not.toBeNull();
    if (!lines) {
      return;
    }
    expect(lines.map((line) => line.kind)).toEqual(["del", "add"]);
    expect(lines[0].oldNumber).toBe(1);
    expect(lines[1].newNumber).toBe(1);
  });

  it("returns null for empty or unrecognizable fences", () => {
    expect(parseUnifiedDiff("")).toBeNull();
    expect(parseUnifiedDiff("   \n")).toBeNull();
    expect(parseUnifiedDiff("not a diff\njust text\n")).toBeNull();
  });
});

describe("pairDiffRows", () => {
  it("pairs the i-th deletion with the i-th addition", () => {
    const lines = parseUnifiedDiff(
      "@@ -1,4 +1,4 @@\n context\n-old\n+new\n tail\n"
    );
    if (!lines) {
      throw new Error("expected a parsed diff");
    }
    const rows = pairDiffRows(lines);

    expect(rows.map((row) => row.kind)).toEqual(["hunk", "context", "del", "context"]);
    expect(rows[0].full).toBe("@@ -1,4 +1,4 @@");
    expect(rows[1].left?.number).toBe(1);
    expect(rows[1].right?.number).toBe(1);
    expect(rows[1].left?.text).toBe("context");
    expect(rows[1].right?.text).toBe("context");

    expect(rows[2].left?.kind).toBe("del");
    expect(rows[2].left?.number).toBe(2);
    expect(rows[2].left?.text).toBe("old");
    expect(rows[2].right?.kind).toBe("add");
    expect(rows[2].right?.number).toBe(2);
    expect(rows[2].right?.text).toBe("new");

    expect(rows[3].left?.number).toBe(3);
    expect(rows[3].right?.number).toBe(3);
  });

  it("keeps leftovers with an empty cell on the other side", () => {
    const lines = parseUnifiedDiff("@@ -1,2 +1,1 @@\n-a\n-b\n+c\n");
    if (!lines) {
      throw new Error("expected a parsed diff");
    }
    const rows = pairDiffRows(lines);

    expect(rows).toHaveLength(3);
    expect(rows[0].kind).toBe("hunk");
    expect(rows[1].left?.text).toBe("a");
    expect(rows[1].right?.text).toBe("c");
    expect(rows[2].left?.text).toBe("b");
    expect(rows[2].left?.kind).toBe("del");
    expect(rows[2].right?.kind).toBe("empty");
    expect(rows[2].right?.number).toBeNull();
  });
});

describe("renderDiff", () => {
  it("renders the toolbar and both panes", () => {
    const html = renderDiff(SAMPLE, "", { themeName: "auto" });
    expect(html).not.toBeNull();
    if (!html) {
      return;
    }

    expect(html).toContain('class="mdprv-diff" data-diff-view="inline"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Modo de visualização do diff"');
    expect(html).toContain('data-diff-view-target="inline" aria-pressed="true"');
    expect(html).toContain('data-diff-view-target="split" aria-pressed="false"');
    expect(html).toContain('class="mdprv-diff-pane mdprv-diff-pane--inline"');
    expect(html).toContain(
      'class="mdprv-diff-pane mdprv-diff-pane--split" data-diff-pane="split" hidden'
    );
    expect(html).toContain('data-diff-kind="add"');
    expect(html).toContain('data-diff-kind="del"');
    expect(html).toContain('data-diff-kind="context"');
    expect(html).toContain('data-diff-kind="hunk"');
    expect(html).toContain('data-diff-kind="meta"');
    expect(html).toContain('class="mdprv-diff-num"');
    expect(html).toContain('class="mdprv-diff-mark is-add">+</td>');
    expect(html).toContain('class="mdprv-diff-mark is-del">-</td>');
    expect(html).toContain('class="mdprv-diff-code');
    expect(html).toContain('class="mdprv-diff-row is-del is-add"');
    expect(html).not.toContain("<pre");
  });

  it("renders an empty side for unpaired split rows", () => {
    const html = renderDiff("@@ -1,2 +1 @@\n-a\n-b\n+c\n", "", {
      themeName: "auto",
    });
    expect(html).not.toBeNull();
    if (!html) {
      return;
    }
    expect(html).toContain('class="mdprv-diff-num is-empty"');
    expect(html).toContain('class="mdprv-diff-mark is-empty"');
    expect(html).toContain('class="mdprv-diff-code is-empty"');
  });

  it("escapes user content", () => {
    const html = renderDiff(
      '@@ -1 +1 @@\n-<script>alert("x") & y</script>\n+<b>ok</b> & done\n',
      "",
      { themeName: "auto" }
    );
    expect(html).not.toBeNull();
    if (!html) {
      return;
    }
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;b&gt;ok&lt;/b&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>ok</b>");
  });

  it("returns null for invalid input", () => {
    expect(renderDiff("just text\n", "", { themeName: "auto" })).toBeNull();
  });
});

describe("diff fences in Markdown", () => {
  it("highlights lines when a language is provided", async () => {
    const html = await renderMarkdown(
      "```diff ts\n@@ -1 +1 @@\n-const answer: number = 41;\n+const answer: number = 42;\n```\n",
      "auto",
      "doc"
    );
    expect(html).toContain('class="mdprv-diff"');
    expect(html).toContain("mdprv-diff-token");
    expect(html).toContain("--shiki-light");
    expect(html).toContain("--shiki-dark");
    expect(html).toContain('class="mdprv-diff-mark is-del">-</td>');
    expect(html).toContain('class="mdprv-diff-mark is-add">+</td>');
  }, 30000);

  it("silently falls back to plain text for unknown languages", async () => {
    const html = await renderMarkdown(
      "```diff nope\n@@ -1 +1 @@\n-old\n+new\n```\n",
      "auto",
      "doc"
    );
    expect(html).toContain('class="mdprv-diff"');
    expect(html).toContain(">old<");
    expect(html).toContain(">new<");
    expect(html).not.toContain("mdprv-diff-token");
  }, 30000);

  it("falls back to a plain code block for invalid diff fences", async () => {
    const html = await renderMarkdown("```diff\nnot a diff\njust text\n```\n", "auto", "doc");
    expect(html).toContain('<pre><code class="language-diff">');
    expect(html).not.toContain("mdprv-diff");
  }, 30000);

  it("falls back for empty diff fences", async () => {
    const html = await renderMarkdown("```diff\n```\n", "auto", "doc");
    expect(html).toContain('<pre><code class="language-diff">');
    expect(html).not.toContain("mdprv-diff");
  }, 30000);
});
