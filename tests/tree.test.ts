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

/**
 * Fixture from README.md: an indentation-only tree (no connectors) with inline
 * comments. `tests/` and `build.ts` sit at level zero, so the fence gets an
 * implicit `.` root.
 */
const README_TREE = `src/
  application/cli/      # entrypoint, subcomandos, cliente do daemon, abertura do navegador
  application/daemon/   # Bun.serve, rotas SSE, watch de arquivos, imagens, assets
  core/                 # renderização (markdown-it, Shiki), config, temas, estado
  ui/                   # index.html, islands, services e estilos do cliente
  shared/               # utilitários usados pelo servidor e pelo cliente
tests/                  # testes de unidade e integração
build.ts                # build do cliente e do binário
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

  it("separates an inline comment from the entry name", () => {
    const parsed = parseTree(
      "root\n├── core/   # renderização, config e temas\n└── README.md  # documentação\n"
    );
    expect(parsed).not.toBeNull();
    const [core, readme] = parsed!.root.children;
    expect(core!.name).toBe("core/");
    expect(core!.comment).toBe("renderização, config e temas");
    expect(core!.directory).toBe(true);
    expect(readme!.name).toBe("README.md");
    expect(readme!.comment).toBe("documentação");
    expect(readme!.directory).toBe(false);
  });

  it("keeps # inside names that are not separated by whitespace", () => {
    const parsed = parseTree("root\n├── file#1.ts\n├── C#/\n└── #1.ts\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.children.map((child) => child.name)).toEqual([
      "file#1.ts",
      "C#/",
      "#1.ts",
    ]);
    expect(parsed!.root.children.every((child) => child.comment === null)).toBe(true);
    expect(parsed!.root.children[1]!.directory).toBe(true);
  });

  it("parses standalone comment rows without counting them as children", () => {
    const parsed = parseTree(
      "root\n├── src\n│   ├── index.ts\n    # nota solta\n│   └── util.ts\n└── README.md\n"
    );
    expect(parsed).not.toBeNull();
    const src = parsed!.root.children[0]!;
    expect(src.children.map((child) => child.name)).toEqual(["index.ts", "", "util.ts"]);
    expect(src.children.map((child) => child.comment)).toEqual([null, "nota solta", null]);
    expect(src.count).toBe(2);
    expect(src.directory).toBe(true);

    const html = renderTree(
      "root\n├── src\n│   ├── index.ts\n    # nota solta\n│   └── util.ts\n└── README.md\n"
    );
    expect(html).not.toBeNull();
    expect(html!).toContain("mdprv-tree-comment");
    expect(html!).toContain("# nota solta");
  });

  it("does not let standalone comments change the tree shape", () => {
    const parsed = parseTree("root\n  src\n# nota # dois\n        # nota profunda\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("root");
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["src", ""]);
    expect(parsed!.root.children[1]!.comment).toBe("nota # dois");
    expect(parsed!.root.children[0]!.children.map((child) => child.name)).toEqual([""]);
    expect(parsed!.root.children[0]!.children[0]!.comment).toBe("nota profunda");
  });

  it("parses an indentation-only tree with an inferred unit", () => {
    const parsed = parseTree("projeto\n  src\n    index.ts\n  tests\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.name).toBe("projeto");
    expect(parsed!.root.implicitRoot).toBe(false);
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["src", "tests"]);
    expect(parsed!.root.children[0]!.children[0]!.name).toBe("index.ts");
    expect(parsed!.root.children[1]!.directory).toBe(false);
  });

  it("rounds irregular indentation down to the nearest inferred level", () => {
    const parsed = parseTree("root\n  a\n     b\n  c\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["a", "c"]);
    expect(parsed!.root.children[0]!.children.map((child) => child.name)).toEqual(["b"]);
  });

  it("parses the README indentation-only tree with comments", () => {
    const parsed = parseTree(README_TREE);
    expect(parsed).not.toBeNull();
    const root = parsed!.root;
    expect(root.name).toBe(".");
    expect(root.implicitRoot).toBe(true);
    expect(root.count).toBe(8);
    expect(root.children.map((child) => child.name)).toEqual(["src/", "tests/", "build.ts"]);

    const src = root.children[0]!;
    expect(src.directory).toBe(true);
    expect(src.count).toBe(5);
    expect(src.children.map((child) => child.name)).toEqual([
      "application/cli/",
      "application/daemon/",
      "core/",
      "ui/",
      "shared/",
    ]);
    expect(src.children[2]!.comment).toBe(
      "renderização (markdown-it, Shiki), config, temas, estado"
    );
    expect(src.children[2]!.directory).toBe(true);
    expect(src.children[2]!.count).toBe(0);
    expect(root.children[1]!.comment).toBe("testes de unidade e integração");
    expect(root.children[2]!.comment).toBe("build do cliente e do binário");
    expect(root.children[2]!.directory).toBe(false);
  });

  it("accepts indentation-only rows inside a connector tree", () => {
    const parsed = parseTree("root\n├── src\n    index.ts\n└── README.md\n");
    expect(parsed).not.toBeNull();
    expect(parsed!.root.children.map((child) => child.name)).toEqual(["src", "README.md"]);
    expect(parsed!.root.children[0]!.children.map((child) => child.name)).toEqual(["index.ts"]);
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

  it("renders an inline comment right after the name", () => {
    const html = renderTree("root\n└── core/   # renderização e temas\n");
    expect(html).not.toBeNull();
    expect(html!).toContain(
      '<span class="mdprv-tree-name">core/</span><span class="mdprv-tree-comment"># renderização e temas</span>'
    );
    expect(html!).toContain("mdprv-tree-icon--dir");
  });

  it("renders standalone comment rows with escaped text", () => {
    const html = renderTree("root\n└── src\n    # <b>nota</b>\n");
    expect(html).not.toBeNull();
    expect(html!).toContain("mdprv-tree-row--comment");
    expect(html!).toContain('<span class="mdprv-tree-comment"># &lt;b&gt;nota&lt;/b&gt;</span>');
    expect(html!).not.toContain("<b>");
  });

  it("does not render a row for the implicit root", () => {
    const html = renderTree(README_TREE);
    expect(html).not.toBeNull();
    expect(html!).not.toContain('<span class="mdprv-tree-name">.</span>');
    // The list starts directly with the first top-level entry.
    expect(html!).toContain(
      '<ul class="mdprv-tree-list"><li class="mdprv-tree-item mdprv-tree-item--dir"><details'
    );
    expect(html!).toContain('<span class="mdprv-tree-name">src/</span>');
    expect(html!).toContain('<span class="mdprv-tree-name">tests/</span>');
    expect(html!).toContain('<span class="mdprv-tree-name">build.ts</span>');
    expect(html!).toContain("mdprv-tree-icon--file");
    expect(html!).toContain("mdprv-tree-icon--dir");
  });

  it("keeps an explicit root as a visible row", () => {
    const html = renderTree("projeto\n  src\n    index.ts\n");
    expect(html).not.toBeNull();
    expect(html!).toContain('<span class="mdprv-tree-name">projeto</span>');
    expect(html!).toContain('<span class="mdprv-tree-count">2 itens</span>');
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
    expect(renderTree("a\nb\n")).toBeNull();
    // A root whose only children are comments is still not a tree.
    expect(renderTree("root\n  # nota\n")).toBeNull();
  });

  it("puts the Raw toggle before the bulk actions", () => {
    const html = renderTree(SIMPLE, {
      renderSource: (source) => `<pre class="shiki">${source}</pre>`,
    });
    expect(html).not.toBeNull();
    const raw = html!.indexOf('data-mdprv-tree-action="raw"');
    const expand = html!.indexOf('data-mdprv-tree-action="expand"');
    expect(raw).toBeGreaterThan(-1);
    expect(expand).toBeGreaterThan(raw);
    expect(html!).toContain('class="mdprv-view-btn mdprv-tree-raw-toggle"');
    expect(html!).toContain('aria-pressed="false"');
  });

  it("renders the highlighted source hidden behind the toggle", () => {
    const html = renderTree(SIMPLE, {
      renderSource: (source) => `<pre class="shiki">${source}</pre>`,
    });
    expect(html).not.toBeNull();
    expect(html!).toContain('<div class="mdprv-tree-raw" data-mdprv-tree-raw hidden>');
    expect(html!).toContain('<pre class="shiki">');
    // The tree stays the default view; the raw block only appears on demand.
    expect(html!).toContain('<ul class="mdprv-tree-list">');
    expect(html!.indexOf('<ul class="mdprv-tree-list">')).toBeLessThan(
      html!.indexOf("data-mdprv-tree-raw")
    );
  });

  it("omits the Raw toggle when the source cannot be highlighted", () => {
    const html = renderTree(SIMPLE, { renderSource: () => "" });
    expect(html).not.toBeNull();
    expect(html!).not.toContain("mdprv-tree-raw");
    expect(html!).not.toContain("mdprv-tree-raw-toggle");
    expect(html!).toContain("Expandir tudo");
  });
});
