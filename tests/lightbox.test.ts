import { describe, expect, test } from "bun:test";

import { fitScale, imageCopyMode, isPngBytes } from "../src/shared/lightbox";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe("fitScale", () => {
  test("shrinks a large diagram/image to the available box", () => {
    expect(fitScale(800, 600, 1600, 1200, 4)).toBeCloseTo(0.5);
  });

  test("never upscales images past 100%", () => {
    expect(fitScale(1200, 900, 200, 100, 1)).toBe(1);
  });

  test("still lets small diagrams grow like the old lightbox", () => {
    expect(fitScale(1200, 900, 200, 100, 4)).toBe(4);
    expect(fitScale(1000, 500, 200, 100, 4)).toBe(4);
  });

  test("caps growth at maxScale when the box is much larger", () => {
    expect(fitScale(10000, 10000, 100, 100, 4)).toBe(4);
  });

  test("falls back to 1 for empty/zero dimensions", () => {
    expect(fitScale(0, 600, 100, 100, 4)).toBe(1);
    expect(fitScale(800, 600, 0, 100, 4)).toBe(1);
    expect(fitScale(Number.NaN, 600, 100, 100, 4)).toBe(1);
  });
});

describe("imageCopyMode", () => {
  test("accepts real PNG bytes regardless of the declared type", () => {
    expect(imageCopyMode("image/png", PNG)).toBe("png");
    expect(imageCopyMode("", PNG)).toBe("png");
    expect(imageCopyMode("application/octet-stream", PNG)).toBe("png");
  });

  test("does not trust a lying PNG Content-Type", () => {
    expect(imageCopyMode("image/png", new Uint8Array([0xff, 0xd8, 0xff]))).toBe("convert");
    expect(imageCopyMode("image/png", new Uint8Array())).toBe("convert");
  });

  test("converts JPEG/WebP/SVG through the canvas", () => {
    expect(imageCopyMode("image/jpeg", new Uint8Array([0xff, 0xd8]))).toBe("convert");
    expect(imageCopyMode("image/webp", new Uint8Array([0x52, 0x49]))).toBe("convert");
    expect(imageCopyMode("image/svg+xml", new Uint8Array())).toBe("convert");
  });
});

describe("isPngBytes", () => {
  test("recognizes the 8-byte signature only", () => {
    expect(isPngBytes(PNG)).toBe(true);
    expect(isPngBytes(PNG.slice(0, 7))).toBe(false);
    expect(isPngBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]))).toBe(false);
  });
});
