import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BUNDLED_ICON_SVGS, builtinIconSvg } from "../src/core/icons/builtin";
import { ICON_KEYS } from "../src/core/icons/constants";
import { createIconStore } from "../src/core/icons/store";

const ICONS_DIR = join(import.meta.dir, "..", "icons");

function looksLikeSvg(svg: string): boolean {
  return svg.trim().includes("<svg") && svg.includes("</svg>");
}

describe("builtin icon assets", () => {
  it("covers every closed icon key with a valid embedded SVG", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("breeze");
    for (const key of ICON_KEYS) {
      const relative = pack.icons[key];
      expect(relative).toBeDefined();
      if (!relative) {
        continue;
      }
      const svg = builtinIconSvg("breeze", key);
      expect(svg).not.toBeNull();
      expect(svg!.length).toBeGreaterThan(50);
      expect(looksLikeSvg(svg!)).toBe(true);
    }
  });

  it("keeps the generated map in sync with the manifest", () => {
    expect(BUNDLED_ICON_SVGS.size).toBe(ICON_KEYS.length * 2);
    for (const key of ICON_KEYS) {
      expect(BUNDLED_ICON_SVGS.has(`breeze:${key}`)).toBe(true);
      expect(BUNDLED_ICON_SVGS.has(`lucide:${key}`)).toBe(true);
    }
  });

  it("ships every manifest path on disk", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("breeze");
    for (const key of ICON_KEYS) {
      const relative = pack.icons[key]!;
      const text = readFileSync(join(ICONS_DIR, relative), "utf8");
      expect(looksLikeSvg(text)).toBe(true);
    }
  });

  it("names the license and attribution in the manifest", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("breeze");
    expect(pack.license).toBe("LGPL-3.0-or-later");
    expect(pack.attribution).toContain("KDE Visual Design Group");
    expect(pack.attribution).toContain("6.31.0");
  });
});

describe("builtin lucide icon assets", () => {
  it("covers every closed icon key with a valid embedded SVG", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("lucide");
    for (const key of ICON_KEYS) {
      const relative = pack.icons[key];
      expect(relative).toBe(`lucide/${key}.svg`);
      const svg = builtinIconSvg("lucide", key);
      expect(svg).not.toBeNull();
      expect(svg!.length).toBeGreaterThan(50);
      expect(looksLikeSvg(svg!)).toBe(true);
      expect(svg!).toContain('stroke="currentColor"');
      expect(svg!).toContain('fill="none"');
      expect(svg!).toContain('xmlns="http://www.w3.org/2000/svg"');
    }
  });

  it("ships every manifest path on disk and validates the manifest", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("lucide");
    expect(pack.schemaVersion).toBe(1);
    expect(pack.name).toBe("lucide");
    expect(pack.style).toBe("symbolic");
    expect(Object.keys(pack.icons)).toHaveLength(ICON_KEYS.length);
    for (const key of ICON_KEYS) {
      const relative = pack.icons[key]!;
      const text = readFileSync(join(ICONS_DIR, relative), "utf8");
      expect(looksLikeSvg(text)).toBe(true);
    }
  });

  it("declares the ISC license and Lucide attribution", () => {
    const store = createIconStore({ dir: null, watch: false });
    const pack = store.get("lucide");
    expect(pack.label).toBe("Lucide");
    expect(pack.license).toBe("ISC");
    expect(pack.attribution).toContain("Lucide Contributors");
    expect(pack.attribution).toContain("lucide-static 1.82.0");
    expect(readFileSync(join(ICONS_DIR, "LUCIDE-LICENSE.txt"), "utf8")).toContain("ISC License");
  });
});
