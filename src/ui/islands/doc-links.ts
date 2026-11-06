import { isPlainDocLinkActivation } from "../../core/doc-links";
import { writeLoaderIntent } from "../prefs";

function announce(message: string): void {
  const region = document.getElementById("mdprv-status");
  if (region) {
    region.textContent = message;
  }
}

function anchorFrom(target: unknown): HTMLAnchorElement | null {
  if (!target || typeof (target as Element).closest !== "function") {
    return null;
  }
  return (target as Element).closest("a[href]") as HTMLAnchorElement | null;
}

function hashFromRel(url: URL): string {
  const rel = url.searchParams.get("rel") ?? "";
  const index = rel.indexOf("#");
  return index >= 0 ? rel.slice(index) : "";
}

async function resolveAndNavigate(href: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(href, location.href);
  } catch {
    announce("Document not found");
    return;
  }
  if (url.origin !== location.origin) {
    return;
  }

  const linkHash = hashFromRel(url) || url.hash;
  let response: Response;
  try {
    response = await fetch(url.pathname + url.search, {
      method: "HEAD",
      redirect: "follow",
      headers: { Accept: "text/html" },
    });
  } catch {
    announce("Document not found");
    return;
  }
  if (!response.ok) {
    announce("Document not found");
    return;
  }

  let final: URL;
  try {
    final = new URL(response.url);
  } catch {
    final = new URL(url.pathname + url.search, location.href);
  }
  if (final.origin !== location.origin) {
    announce("Document not found");
    return;
  }

  writeLoaderIntent(final.pathname);
  const hash = final.hash || linkHash;
  location.assign(final.pathname + final.search + hash);
}

export function initDocLinks(): void {
  document.addEventListener(
    "click",
    (event) => {
      const anchor = anchorFrom(event.target);
      if (!anchor) {
        return;
      }

      if (anchor.getAttribute("data-mdprv-doc-missing") === "1") {
        event.preventDefault();
        announce("Document not found");
        return;
      }

      if (anchor.getAttribute("data-mdprv-doc-resolve") !== "1") {
        return;
      }

      const plain = isPlainDocLinkActivation(
        {
          target: anchor.getAttribute("target"),
          hasDownload: anchor.hasAttribute("download"),
        },
        event
      );
      if (!plain) {
        return;
      }

      event.preventDefault();
      void resolveAndNavigate(anchor.href);
    },
    true
  );
}
