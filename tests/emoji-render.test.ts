import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateEmojiPack } from "../src/core/emoji/validate";
import { setEmojiStore } from "../src/core/emoji/index";
import { createEmojiStore } from "../src/core/emoji/store";
import { renderMarkdown } from "../src/core/markdown/render";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "mdprv-emoji-render-"));
  dirs.push(dir);
  return dir;
}

function usePack(
  name: string,
  shortcodes: Record<string, string>,
  options: { style?: string; assets?: string[] } = {}
) {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.json`),
    JSON.stringify({ schemaVersion: 1, name, style: options.style ?? "native", shortcodes })
  );
  if (options.assets) {
    const assets = join(dir, "assets", name);
    mkdirSync(assets, { recursive: true });
    for (const asset of options.assets) {
      writeFileSync(join(assets, `${asset}.svg`), "<svg/>");
    }
  }
  const store = createEmojiStore({ dir, watch: false });
  setEmojiStore(store);
  return store;
}

afterEach(() => {
  setEmojiStore(null);
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("emoji rendering", () => {
  it("expands known shortcodes and leaves unknown ones literal", async () => {
    const pack = validateEmojiPack("custom", {
      schemaVersion: 1,
      name: "custom",
      shortcodes: { smile: "😄", "+1": "👍" },
    });
    const html = await renderMarkdown("Hello :smile: :+1: :nope:\n", "auto", "doc", {
      emoji: pack,
    });
    expect(html).toContain("Hello 😄 👍 :nope:");
    expect(html).not.toContain("mdprv-emoji");
  });

  it("keeps shortcodes literal inside code spans and fences", async () => {
    const store = usePack("custom", { smile: "😄" });
    const html = await renderMarkdown(
      "`:smile:` and\n\n```\n:smile:\n```\n",
      "auto",
      "doc",
      { emoji: store.get("custom") }
    );
    expect(html).toContain("<code>:smile:</code>");
    expect(html).toContain(":smile:");
    expect(html).not.toContain("😄");
  });

  it("does not change output for documents without shortcodes", async () => {
    const store = usePack("custom", { smile: "😄" });
    const html = await renderMarkdown("# Title\n\nPlain **text**.\n", "auto", "doc", {
      emoji: store.get("custom"),
    });
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain("<strong>text</strong>");
  });

  it("busts the renderer cache when the pack changes", async () => {
    const firstStore = usePack("first", { smile: "😄" });
    const first = await renderMarkdown(":smile:", "auto", "doc", {
      emoji: firstStore.get("first"),
    });
    expect(first).toContain("😄");

    const secondStore = usePack("second", { smile: "😎" });
    const second = await renderMarkdown(":smile:", "auto", "doc", {
      emoji: secondStore.get("second"),
    });
    expect(second).toContain("😎");
    expect(second).not.toContain("😄");
  });

  it("emits an img for twemoji/noto assets and falls back to Unicode when missing", async () => {
    const store = usePack(
      "twemoji",
      { smile: "😄", wink: "😉" },
      { style: "twemoji", assets: ["smile"] }
    );
    const html = await renderMarkdown(":smile: :wink:", "auto", "doc", {
      emoji: store.get("twemoji"),
    });
    expect(html).toContain(
      '<img class="mdprv-emoji" src="/__emoji-assets/twemoji/smile.svg" alt=":smile:" loading="lazy">'
    );
    // `wink` has no SVG, so the Unicode fallback is used without a 404.
    expect(html).not.toContain("/__emoji-assets/twemoji/wink.svg");
    expect(html).toContain("😉");
  });

  it("renders inline SVG data URIs as images even in native style", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"/>`;
    const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const store = usePack("inline", { logo: data });
    const html = await renderMarkdown(":logo:", "auto", "doc", {
      emoji: store.get("inline"),
    });
    expect(html).toContain(`<img class="mdprv-emoji" src="${data}" alt=":logo:" loading="lazy">`);
  });

  it("escapes HTML in the Unicode value", async () => {
    // The validator rejects `<`, but the renderer must stay safe even when a
    // pack is built programmatically.
    const pack = {
      schemaVersion: 1 as const,
      name: "custom",
      style: "native" as const,
      shortcodes: { smile: "<b>" },
      id: "test",
    };
    const html = await renderMarkdown(":smile:", "auto", "doc", { emoji: pack });
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });
});
