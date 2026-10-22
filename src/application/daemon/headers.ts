export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

export function baseHeaders(contentType: string): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    Connection: "close",
    ...SECURITY_HEADERS,
  };
}

export const FONT_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function fontAssetHeaders(): Record<string, string> {
  return {
    "Content-Type": "font/woff2",
    "Cache-Control": FONT_ASSET_CACHE_CONTROL,
    Connection: "close",
    ...SECURITY_HEADERS,
  };
}
