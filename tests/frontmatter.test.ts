import { describe, expect, it } from "bun:test";

import { parseFrontmatter } from "../src/core/frontmatter";

describe("parseFrontmatter", () => {
  it("parses valid frontmatter and strips it from the body", () => {
    const source = "---\ntitle: Hello\ntags:\n  - one\n  - two\n---\n# Body\n";
    const { data, body } = parseFrontmatter(source);
    expect(data.title).toBe("Hello");
    expect(data.tags).toEqual(["one", "two"]);
    expect(body).toBe("# Body\n");
  });

  it("supports '...' as the closing delimiter", () => {
    const source = "---\ntitle: Done\n...\nbody\n";
    const { data, body } = parseFrontmatter(source);
    expect(data.title).toBe("Done");
    expect(body).toBe("body\n");
  });

  it("strips a BOM before the opening delimiter", () => {
    const source = "\uFEFF---\ntitle: BOM\n---\nbody\n";
    const { data, body } = parseFrontmatter(source);
    expect(data.title).toBe("BOM");
    expect(body).toBe("body\n");
  });

  it("returns the content unchanged when frontmatter is absent", () => {
    const source = "# No frontmatter\n";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  it("returns the content unchanged when the frontmatter is malformed", () => {
    const source = "---\ntitle: [unclosed\n---\nbody\n";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });

  it("returns the content unchanged when the closing delimiter is missing", () => {
    const source = "---\ntitle: Nope\nbody\n";
    expect(parseFrontmatter(source)).toEqual({ data: {}, body: source });
  });
});
