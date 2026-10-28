import { describe, expect, it } from "bun:test";

import { parseTree, renderTree } from "../src/core/markdown/tree";

const SIMPLE = `meu-projeto
├── src
│   ├── index.ts
│   └── lib
│       └── util.ts
├── docs
│   └── README.md
└── package.json

3 directories, 4 files
`;

const HIDDEN = `.
├── .git
│   └── config
├── .gitignore
└── src
    └── main.ts

2 directories, 3 files
`;

const DIRS_ONLY = `.
├── src
│   ├── core
│   └── ui
└── tests

4 directories, 0 files
`;

/**
 * Regression fixture: a tree copied from a rendered page. The indentation
 * gutter is `│` followed by two no-break spaces and one regular space, and the
 * block has no `N directories, M files` footer.
 */
const NBSP = "\u00a0\u00a0";
const NBSP_TREE = `md-preview
├── docs
│${NBSP} └── fixtures
│${NBSP}     ├── img
│${NBSP}     │${NBSP} └── foto.png
│${NBSP}     └── reference.md
└── package.json
`;

describe("parseTree", () => {
  it("parses a simple tree and computes descendant totals", () => {
    const parsed = parseTree(SIMPLE);
    expect(parsed).not.toBeNull();
    const root = parsed!.root;
    expect(root.name).toBe("meu-projeto");
    expect(root.directory).toBe(true);
    expect(root.count).toBe(7);
    expect(root.children.map((child) => child.name)).toEqual(["src", "docs", "package.json"]);

    const src = root.children[0]!;
    expect(src.depth).toBe(1);
    expect(src.directory).toBe(true);
    expect(src.count).toBe(3);
    expect(src.children.map((child) => child.name)).toEqual(["index.ts", "lib"]);

    const lib = src.children[1]!;
    expect(lib.depth).toBe(2);
    expect(lib.directory).toBe(true);
    expect(lib.count).toBe(1);
    expect(lib.children[0]!.name).toBe("util.ts");
    expect(lib.children[0]!.directory).toBe(false);

    expect(root.children[2]!.directory).toBe(false);
    expect(parsed!.footer).toEqual({ directories: 3, files: 4 });
  });

  it("accepts tree -a output with hidden names", () => {
    const parsed = parseTree(HIDDEN);
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe(".");
    expect(parsed!.root.children.map((child) => child.name)).toEqual([".git", ".gitignore", "src"]);
    expect(parsed!.root.children[0]!.directory).toBe(true);
    expect(parsed!.root.children[1]!.directory).toBe(false);
    expect(parsed!.footer).toEqual({ directories: 2, files: 3 });
  });

  it("marks every entry as a directory for tree -d output", () => {
    const parsed = parseTree(DIRS_ONLY);
    expect(parsed).not.toBeNull();
    const nodes = [parsed!.root, ...parsed!.root.children.flatMap((child) => [child, ...child.children])];
    expect(nodes.every((node) => node.directory)).toBe(true);
    expect(parsed!.footer).toEqual({ directories: 4, files: 0 });
  });

  it("honours the dirsOnly option when the report footer is absent", () => {
    const parsed = parseTree(".\n├── src\n└── tests\n", { dirsOnly: true });
    expect(parsed).not.toBeNull();
    expect(parsed!.root.children.every((child) => child.directory)).toBe(true);
  });

  it("accepts a tree without the report footer", () => {
    const parsed = parseTree("projeto\n└── README.md\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.footer).toBeNull();
    expect(parsed!.root.children[0]!.directory).toBe(false);
  });

  it("parses a tree with no-break indentation and no report footer", () => {
    const parsed = parseTree(NBSP_TREE);
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("md-preview");
    expect(parsed!.footer).toBeNull();
    expect(parsed!.root.children.map((child) => child.name)).toContain("docs");

    const docs = parsed!.root.children.find((child) => child.name === "docs")!;
    const fixtures = docs.children.find((child) => child.name === "fixtures")!;
    expect(fixtures.children.map((child) => child.name)).toEqual(["img", "reference.md"]);
    expect(fixtures.children[0]!.children[0]!.name).toBe("foto.png");
    expect(fixtures.children[1]!.directory).toBe(false);

    const html = renderTree(NBSP_TREE);
    expect(html).not.toBeNull();
    expect(html!).toContain("data-mdprv-tree");
    expect(html!).toContain("mdprv-tree-dir");
  });

  it("accepts a footer that only reports directories", () => {
    const parsed = parseTree(".\n├── src\n└── tests\n\n4 directories\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.footer).toEqual({ directories: 4, files: null });
    // A directories-only footer is what `tree -d` prints.
    expect(parsed!.root.children.every((child) => child.directory)).toBe(true);
  });

  it("accepts a footer that only reports files", () => {
    const parsed = parseTree(".\n├── src\n└── tests\n\n7 files\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.footer).toEqual({ directories: null, files: 7 });
  });

  it("accepts a footer separated from the tree by blank lines", () => {
    const parsed = parseTree("root\n├── src\n│   └── index.ts\n└── README.md\n\n3 directories, 4 files\n\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.footer).toEqual({ directories: 3, files: 4 });
  });

  it("accepts CRLF input with an optional footer", () => {
    const withoutFooter = parseTree("root\r\n├── src\r\n│   └── index.ts\r\n└── README.md\r\n");
    expect(withoutFooter).not.toBeNull();
    expect(withoutFooter!.footer).toBeNull();
    expect(withoutFooter!.root.children[0]!.children[0]!.name).toBe("index.ts");

    const withFooter = parseTree("root\r\n└── README.md\r\n\r\n1 directory, 1 file\r\n");
    expect(withFooter).not.toBeNull();
    expect(withFooter!.footer).toEqual({ directories: 1, files: 1 });
  });

  it("accepts classic ASCII connectors and shared indentation", () => {
    const parsed = parseTree("  projeto\n  |-- src\n  |   `-- index.ts\n  `-- README.md\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("projeto");
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["src", "README.md"]);
    expect(parsed!.root.children[0]!.children[0]!.name).toBe("index.ts");
  });

  it("accepts Windows tree connectors", () => {
    const parsed = parseTree("C:.\n├───src\n│   └───index.ts\n└───README.md\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("C:.");
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["src", "README.md"]);
    expect(parsed!.root.children[0]!.children[0]!.name).toBe("index.ts");
  });

  it("strips ANSI color codes", () => {
    const parsed = parseTree("\u001b[1;34mroot\u001b[0m\n└── \u001b[32mfile\u001b[0m\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("root");
    expect(parsed!.root.children[0]!.name).toBe("file");
  });

  it("preserves spaces and unicode in names", () => {
    const parsed = parseTree(
      "projeto\n├── minha pasta\n│   └── arquivo com espaço.txt\n└── café ☕\n"
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.root.children[0]!.name).toBe("minha pasta");
    expect(parsed!.root.children[0]!.children[0]!.name).toBe("arquivo com espaço.txt");
    expect(parsed!.root.children[1]!.name).toBe("café ☕");
  });

  it("returns null for input that is not tree output", () => {
    expect(parseTree("")).toBeNull();
    expect(parseTree("2 directories, 3 files\n")).toBeNull();
    expect(parseTree("├── a\n└── b\n")).toBeNull();
    expect(parseTree("root\nplain text\n")).toBeNull();
    expect(parseTree("only some text\n")).toBeNull();
    expect(parseTree("root\n    └── gap\n")).toBeNull();
    expect(parseTree("root\n└── a\n\ntrailing note\n")).toBeNull();

    const deep = [
      "root",
      ...Array.from({ length: 70 }, (_, index) => "    ".repeat(index) + `└── d${index}`),
    ].join("\n");
    expect(parseTree(deep)).toBeNull();
  });
});

describe("renderTree", () => {
  it("renders a semantic details tree with the initial state applied", () => {
    const html = renderTree("root\n├── a\n│   └── b\n│       └── c\n└── d\n");
    expect(html).not.toBeNull();
    expect(html!).toContain('class="mdprv-tree"');
    expect(html!).toContain('data-mdprv-tree');
    expect(html!).toContain('data-mdprv-tree-toolbar');
    expect(html!).toContain("Expandir tudo");
    expect(html!).toContain("Recolher tudo");
    expect(html!).toContain('role="group"');
    expect(html!).toContain('role="button"');
    expect(html!).toContain('aria-label="Árvore de diretórios"');
    expect(html!.match(/aria-expanded="true"/g)?.length).toBe(2);
    expect(html!.match(/aria-expanded="false"/g)?.length).toBe(1);
    expect(html!.match(/ open>/g)?.length).toBe(2);
  });

  it("shows descendant counts for directories only", () => {
    const html = renderTree(SIMPLE);
    expect(html).not.toBeNull();
    expect(html!).toContain('<span class="mdprv-tree-count">7 itens</span>');
    expect(html!).toContain('<span class="mdprv-tree-count">3 itens</span>');
    expect(html!).toContain('<span class="mdprv-tree-count">1 item</span>');
    expect(html!.match(/<span class="mdprv-tree-count">1 item<\/span>/g)?.length).toBe(2);
  });

  it("escapes fence content instead of injecting markup", () => {
    const html = renderTree('root\n└── <script>alert("x") & co</script>\n');
    expect(html).not.toBeNull();
    expect(html!).not.toContain("<script>");
    expect(html!).toContain("&lt;script&gt;");
    expect(html!).toContain("&amp; co");
  });

  it("uses folder rows for tree -d leaves and file rows otherwise", () => {
    const dirs = renderTree(DIRS_ONLY);
    expect(dirs).not.toBeNull();
    expect(dirs!).not.toContain("mdprv-tree-icon--file");

    const files = renderTree(SIMPLE);
    expect(files).not.toBeNull();
    expect(files!).toContain("mdprv-tree-icon--file");
  });

  it("returns null for invalid input so the caller can fall back", () => {
    expect(renderTree("not a tree\njust text\n")).toBeNull();
    expect(renderTree("├── a\n")).toBeNull();
  });
});
