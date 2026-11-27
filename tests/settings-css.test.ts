import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("settings dirty state CSS", () => {
  const css = readFileSync(
    join(import.meta.dir, "../src/ui/styles/settings.css"),
    "utf8"
  );
  const dirty = css.split(".mdprv-settings-modal.is-dirty::after{")[1]?.split("}")[0] ?? "";

  it("marks unsaved changes with an inset glow instead of an outer border", () => {
    expect(css).not.toContain(".mdprv-settings-modal.is-dirty{border-color");
    expect(dirty).toContain("inset 0 0 0 1px color-mix(in srgb,var(--mdprv-accent)");
    expect(dirty).toContain("inset 0 0 12px color-mix(in srgb,var(--mdprv-accent)");
    expect(dirty).toContain("pointer-events:none");
    expect(dirty).toContain("border-radius:inherit");
  });
});
