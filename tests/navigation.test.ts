import { describe, expect, it } from "bun:test";

import {
  LOADER_INTENT_MAX_AGE_MS,
  intentMatches,
  parseLoaderIntent,
  serializeLoaderIntent,
} from "../src/ui/services/loader-intent";
import { shouldMarkNavigation } from "../src/ui/services/navigation";

const CURRENT = "https://preview.test/docs/a";

function link(href: string, extra: { target?: string | null; hasDownload?: boolean } = {}) {
  return { href, ...extra };
}

describe("shouldMarkNavigation", () => {
  it("marks a same-origin navigation", () => {
    expect(shouldMarkNavigation(link("/docs/b"), {}, CURRENT)).toBe(true);
    expect(shouldMarkNavigation(link("b.md"), {}, CURRENT)).toBe(true);
  });

  it("ignores other origins", () => {
    expect(shouldMarkNavigation(link("https://example.com/docs/b"), {}, CURRENT)).toBe(false);
  });

  it("ignores modified and non-primary clicks", () => {
    expect(shouldMarkNavigation(link("/docs/b"), { ctrlKey: true }, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b"), { metaKey: true }, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b"), { shiftKey: true }, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b"), { altKey: true }, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b"), { button: 1 }, CURRENT)).toBe(false);
  });

  it("ignores downloads and external targets", () => {
    expect(shouldMarkNavigation(link("/docs/b", { hasDownload: true }), {}, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b", { target: "_blank" }), {}, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/b", { target: "_self" }), {}, CURRENT)).toBe(true);
  });

  it("ignores hash-only and identical path plus query", () => {
    expect(shouldMarkNavigation(link("#section"), {}, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/a?x=1"), {}, `${CURRENT}?x=1`)).toBe(false);
    expect(shouldMarkNavigation(link("/docs/a?x=2"), {}, `${CURRENT}?x=1`)).toBe(true);
  });

  it("ignores already prevented clicks and unsupported protocols", () => {
    expect(shouldMarkNavigation(link("/docs/b"), { defaultPrevented: true }, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("mailto:dev@example.com"), {}, CURRENT)).toBe(false);
    expect(shouldMarkNavigation(link("javascript:void(0)"), {}, CURRENT)).toBe(false);
  });
});

describe("loader intent", () => {
  const now = 1_000_000;

  it("round-trips a versioned intent", () => {
    const raw = serializeLoaderIntent("/docs/a", now);
    const intent = parseLoaderIntent(raw, now + 500, "/docs/a");
    expect(intent).toEqual({ path: "/docs/a", ts: now });
    expect(intentMatches(intent, "/docs/a")).toBe(true);
    expect(intentMatches(intent, "/docs/b")).toBe(false);
  });

  it("rejects an expired intent", () => {
    const raw = serializeLoaderIntent("/docs/a", now);
    expect(parseLoaderIntent(raw, now + LOADER_INTENT_MAX_AGE_MS + 1, "/docs/a")).toBeNull();
  });

  it("rejects malformed payloads", () => {
    expect(parseLoaderIntent("not json", now, "/")).toBeNull();
    expect(parseLoaderIntent('{"v":2,"path":"/","ts":1}', now, "/")).toBeNull();
    expect(parseLoaderIntent('{"v":1,"path":1,"ts":1}', now, "/")).toBeNull();
  });

  it("accepts the legacy pending marker", () => {
    const intent = parseLoaderIntent("1", now, "/docs/a");
    expect(intent).toEqual({ path: "/docs/a", ts: now });
    expect(intentMatches(intent, "/docs/a")).toBe(true);
  });
});
