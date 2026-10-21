import { describe, expect, it } from "bun:test";

import { renderMeta } from "../src/core/meta";

describe("renderMeta", () => {
  it("returns nothing for absent or empty metadata", () => {
    expect(renderMeta(undefined)).toBe("");
    expect(renderMeta({})).toBe("");
  });

  it("renders arrays as tags and nested objects as code", () => {
    const html = renderMeta({
      title: "Doc",
      tags: ["one", "two"],
      author: { name: "Ada", role: "maintainer" },
    });
    expect(html).toContain('<details class="mdprv-meta-card">');
    expect(html).toContain('<span class="mdprv-tag">one</span>');
    expect(html).toContain('<span class="mdprv-tag">two</span>');
    expect(html).toContain("<code>{&quot;name&quot;:&quot;Ada&quot;,&quot;role&quot;:&quot;maintainer&quot;}</code>");
  });

  it("uses date as the summary, then title, then Metadata", () => {
    expect(renderMeta({ date: "2026-10-21", title: "Doc" })).toContain("<summary>2026-10-21</summary>");
    expect(renderMeta({ title: "Doc" })).toContain("<summary>Doc</summary>");
    expect(renderMeta({ other: "x" })).toContain("<summary>Metadata</summary>");
  });

  it("escapes HTML in keys and values", () => {
    const html = renderMeta({ "<key>": "<value>" });
    expect(html).toContain("&lt;key&gt;");
    expect(html).toContain("&lt;value&gt;");
    expect(html).not.toContain("<value>");
  });
});
