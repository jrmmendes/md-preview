import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SHELL = readFileSync(join(import.meta.dir, "../src/ui/index.html"), "utf8");

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("inline head script not found");
  }
  return match[1];
}

interface FakeStyle {
  values: Map<string, string>;
  setProperty(name: string, value: string): void;
  removeProperty(name: string): void;
  getPropertyValue(name: string): string;
}

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, () => void>();
  readonly style: FakeStyle;
  parentNode: FakeElement | null = null;
  id = "";
  rel = "";
  href = "";
  hidden = false;
  textContent = "";

  constructor(tagName: string) {
    this.tagName = tagName;
    const values = new Map<string, string>();
    this.style = {
      values,
      setProperty(name, value) {
        values.set(name, value);
      },
      removeProperty(name) {
        values.delete(name);
      },
      getPropertyValue(name) {
        return values.get(name) ?? "";
      },
    };
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === "id") {
      this.id = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === "id") {
      this.id = "";
    }
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  removeChild(child: FakeElement): FakeElement {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
    }
    child.parentNode = null;
    return child;
  }

  remove(): void {
    this.parentNode?.removeChild(this);
  }
}

class FakeDocument {
  readonly documentElement = new FakeElement("html");
  readonly head = new FakeElement("head");

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    },
  };
}

interface BootOptions {
  local?: Record<string, string>;
  session?: Record<string, string>;
  navigationType?: string;
}

function boot(options: BootOptions = {}) {
  const document = new FakeDocument();
  const localStorage = storage(options.local);
  const sessionStorage = storage(options.session);
  const window = { localStorage, sessionStorage };
  const location = { pathname: "/docs/a", href: "http://localhost/docs/a" };
  const performance = {
    getEntriesByType: () => [{ type: options.navigationType ?? "navigate" }],
  };
  const run = new Function(
    "window",
    "document",
    "location",
    "performance",
    "Date",
    inlineScript(SHELL)
  );
  run(window, document, location, performance, Date);
  return { document, localStorage, sessionStorage };
}

function fontSelection(value: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, ...value });
}

describe("boot inline script", () => {
  it("applies a local font stack before the body is parsed", () => {
    const { document } = boot({
      local: {
        mdprv_font: fontSelection({
          family: "Inter",
          source: "local",
          stack: '"Inter", system-ui, sans-serif',
        }),
      },
    });
    expect(document.documentElement.style.getPropertyValue("--mdprv-font")).toBe(
      '"Inter", system-ui, sans-serif'
    );
    expect(document.head.children).toHaveLength(0);
  });

  it("migrates a legacy font string to a local stack", () => {
    const { document } = boot({ local: { mdprv_font: "Inter Display" } });
    expect(document.documentElement.style.getPropertyValue("--mdprv-font")).toContain(
      '"Inter Display"'
    );
  });

  it("injects the same-origin Google stylesheet for a stored Google selection", () => {
    const { document } = boot({
      local: {
        mdprv_font: fontSelection({ family: "Inter Display", source: "google" }),
      },
    });
    expect(document.documentElement.style.getPropertyValue("--mdprv-font")).toContain(
      '"Inter Display"'
    );
    expect(document.head.children).toHaveLength(1);
    const link = document.head.children[0];
    expect(link.tagName).toBe("link");
    expect(link.id).toBe("mdprv-font-google-css");
    expect(link.href).toBe("/__fonts/google?family=Inter%20Display");
  });

  it("ignores malformed JSON and invalid families without breaking boot", () => {
    for (const value of ["{not json", '{"v":2,"family":"Inter"}', "Bad;Family", "   "]) {
      const { document } = boot({ local: { mdprv_font: value } });
      expect(document.documentElement.style.getPropertyValue("--mdprv-font")).toBe("");
      expect(document.head.children).toHaveLength(0);
    }
  });

  it("keeps the loader intent working for the current path", () => {
    const intent = JSON.stringify({ v: 1, path: "/docs/a", ts: Date.now() });
    const { document, sessionStorage } = boot({ session: { mdprv_loader_pending: intent } });
    expect(document.documentElement.getAttribute("data-loading")).toBe("1");
    expect(sessionStorage.getItem("mdprv_loader_pending")).toBeNull();
  });

  it("shows the loader on reload but not on back-forward", () => {
    expect(boot({ navigationType: "reload" }).document.documentElement.getAttribute("data-loading")).toBe(
      "1"
    );
    expect(
      boot({ navigationType: "back_forward" }).document.documentElement.getAttribute("data-loading")
    ).toBeNull();
  });
});
