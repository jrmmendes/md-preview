/**
 * Pure parsing of relative links between Markdown documents.
 *
 * Only links to a sibling file in the same directory are considered: the
 * target must carry an explicit Markdown extension and must not escape the
 * directory through `/`, `\`, `..` or a NUL byte. Query and fragment are kept
 * verbatim in `suffix` so the caller can preserve them in the final URL.
 */

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const DOC_EXTENSION_RE = /\.(?:md|markdown|mdc)$/i;

export interface ParsedDocLink {
  /** Decoded file name, without query or fragment. */
  name: string;
  /** Raw `?query#fragment` suffix, preserving the original order. */
  suffix: string;
}

export type DocLinkState = "registered" | "pending" | "missing";

function splitSuffix(href: string): { path: string; suffix: string } {
  const match = href.match(/^([^?#]*)([?#].*)?$/);
  if (!match) {
    return { path: href, suffix: "" };
  }
  return { path: match[1] ?? "", suffix: match[2] ?? "" };
}

export function parseDocLink(href: string): ParsedDocLink | null {
  if (typeof href !== "string" || href === "") {
    return null;
  }
  if (href.startsWith("#") || href.startsWith("/") || href.startsWith("\\")) {
    return null;
  }
  if (href.startsWith("//") || SCHEME_RE.test(href)) {
    return null;
  }
  if (href.includes("\0")) {
    return null;
  }

  const { path, suffix } = splitSuffix(href);
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded === "" || decoded.includes("\0") || decoded.includes("\\")) {
    return null;
  }
  if (decoded.startsWith("./")) {
    decoded = decoded.slice(2);
  }
  if (decoded === "." || decoded === "..") {
    return null;
  }
  // A single remaining slash means a subfolder (or an encoded `../` escape).
  if (decoded.includes("/")) {
    return null;
  }
  if (!DOC_EXTENSION_RE.test(decoded)) {
    return null;
  }
  return { name: decoded, suffix };
}

export interface DocLinkClick {
  defaultPrevented?: boolean;
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

export interface DocLinkTargetAttributes {
  target?: string | null;
  hasDownload?: boolean;
}

/** True for a plain primary click that should stay in the current tab. */
export function isPlainDocLinkActivation(
  link: DocLinkTargetAttributes,
  event: DocLinkClick
): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  if ((event.button ?? 0) !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (link.hasDownload) {
    return false;
  }
  const target = (link.target ?? "").toLowerCase();
  return target === "" || target === "_self";
}
