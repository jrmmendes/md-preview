import { describe, expect, it } from "bun:test";

import {
  activationPlan,
  consumeFocusIntent,
  documentKey,
  markFocusIntent,
} from "../src/ui/services/activate";

const CURRENT = "http://127.0.0.1:4321/docs/a?theme=nord";

describe("documentKey", () => {
  it("keeps path and query but drops the hash", () => {
    expect(documentKey("/docs/a?theme=nord#section", "http://127.0.0.1:4321/")).toBe(
      "/docs/a?theme=nord"
    );
    expect(documentKey("http://127.0.0.1:4321/", "http://ignored.test/")).toBe("/");
  });

  it("returns null for unparsable input", () => {
    expect(documentKey("http://[::1", CURRENT)).toBeNull();
  });
});

describe("activationPlan", () => {
  it("focuses when the tab already shows the document", () => {
    expect(activationPlan(CURRENT, "/docs/a?theme=nord")).toBe("focus");
    expect(activationPlan(CURRENT, "http://127.0.0.1:4321/docs/a?theme=nord#top")).toBe(
      "focus"
    );
  });

  it("navigates in place for another document on the same origin", () => {
    expect(activationPlan(CURRENT, "/docs/b")).toBe("navigate");
    expect(activationPlan(CURRENT, "/docs/a?theme=dracula")).toBe("navigate");
    expect(activationPlan(CURRENT, "http://127.0.0.1:4321/other")).toBe("navigate");
  });

  it("ignores other origins, protocols and malformed targets", () => {
    expect(activationPlan(CURRENT, "https://example.com/docs/b")).toBe("ignore");
    expect(activationPlan(CURRENT, "http://127.0.0.1:9999/docs/b")).toBe("ignore");
    expect(activationPlan(CURRENT, "javascript:alert(1)")).toBe("ignore");
    expect(activationPlan("not a url", "/docs/b")).toBe("ignore");
  });
});

describe("focus intent", () => {
  it("matches the target document and is consumed once", () => {
    markFocusIntent("/docs/b", 1_000);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/b", 1_500)).toBe(true);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/b", 1_500)).toBe(false);
  });

  it("rejects expired or mismatched intents", () => {
    markFocusIntent("/docs/b", 1_000);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/c", 1_500)).toBe(false);

    markFocusIntent("/docs/b", 1_000);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/b", 20_000)).toBe(false);
  });

  it("is consumed at most once", () => {
    markFocusIntent("/docs/b", 1_000);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/b", 1_500)).toBe(true);
    expect(consumeFocusIntent("http://127.0.0.1:4321/docs/b", 1_500)).toBe(false);
  });
});
