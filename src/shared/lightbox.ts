/**
 * Pure decisions shared by the full-screen media lightbox and its tests.
 *
 * The DOM-heavy parts (serializing an `<svg>`, drawing to a canvas) live in the
 * UI island; everything that can be decided from bytes and dimensions is kept
 * here so it can be unit-tested without a browser.
 */

/**
 * `fitScale` returns the factor that fits `mediaWidth x mediaHeight` inside
 * `availableWidth x availableHeight`.
 *
 * Diagrams are allowed to grow (`maxScale` 4, the historical mermaid
 * behavior); images pass `maxScale` 1 so a small logo is never upscaled past
 * 100% in the initial fit. Invalid/empty dimensions collapse to 1.
 */
export function fitScale(
  availableWidth: number,
  availableHeight: number,
  mediaWidth: number,
  mediaHeight: number,
  maxScale: number
): number {
  if (
    !Number.isFinite(availableWidth) ||
    !Number.isFinite(availableHeight) ||
    !Number.isFinite(mediaWidth) ||
    !Number.isFinite(mediaHeight) ||
    availableWidth <= 0 ||
    availableHeight <= 0 ||
    mediaWidth <= 0 ||
    mediaHeight <= 0
  ) {
    return 1;
  }
  const fit = Math.min(availableWidth / mediaWidth, availableHeight / mediaHeight);
  if (!Number.isFinite(fit) || fit <= 0) {
    return 1;
  }
  return Math.min(fit, Math.max(1, maxScale));
}

/** PNG signature (89 50 4E 47 0D 0A 1A 0A). */
export function isPngBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export type ImageCopyMode = "png" | "convert";

/**
 * Decide whether the fetched blob can go straight to the clipboard or needs
 * a canvas round-trip. The magic bytes are authoritative: a server that labels
 * a non-PNG as `image/png` must not make us copy garbage, so a wrong/absent
 * Content-Type simply falls through to the canvas decoder.
 */
export function imageCopyMode(mime: string, bytes: Uint8Array): ImageCopyMode {
  void mime;
  return isPngBytes(bytes) ? "png" : "convert";
}
