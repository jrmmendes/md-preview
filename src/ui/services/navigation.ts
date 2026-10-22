export interface NavigationLink {
  href: string;
  target?: string | null;
  hasDownload?: boolean;
}

export interface NavigationClick {
  button?: number;
  defaultPrevented?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

interface NavigationEvent extends NavigationClick {
  target: unknown;
}

interface NavigationLocation {
  href: string;
  pathname: string;
}

interface NavigationDocument {
  addEventListener(type: "click", listener: (event: NavigationEvent) => void): void;
}

interface AnchorLike extends NavigationLink {
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

interface ClosestLike {
  closest(selector: string): unknown;
}

function readGlobal<T>(name: string): T | undefined {
  const scope = globalThis as unknown as Record<string, unknown>;
  return scope[name] as T | undefined;
}

function currentLocation(): NavigationLocation {
  return readGlobal<NavigationLocation>("location") ?? {
    href: "http://localhost/",
    pathname: "/",
  };
}

function currentDocument(): NavigationDocument | null {
  return readGlobal<NavigationDocument>("document") ?? null;
}

export function shouldMarkNavigation(
  link: NavigationLink,
  event: NavigationClick,
  currentHref: string
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
  if (target && target !== "_self") {
    return false;
  }

  let current: URL;
  let destination: URL;
  try {
    current = new URL(currentHref);
    destination = new URL(link.href, current);
  } catch {
    return false;
  }
  if (destination.origin !== current.origin) {
    return false;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return false;
  }
  if (destination.pathname === current.pathname && destination.search === current.search) {
    return false;
  }
  return true;
}

function anchorFrom(target: unknown): AnchorLike | null {
  if (!target || typeof (target as ClosestLike).closest !== "function") {
    return null;
  }
  const anchor = (target as ClosestLike).closest("a[href]") as AnchorLike | null;
  if (!anchor || typeof anchor.getAttribute !== "function" || typeof anchor.hasAttribute !== "function") {
    return null;
  }
  return anchor;
}

export function initNavigation(onNavigate: (path: string) => void): void {
  const doc = currentDocument();
  if (!doc) {
    return;
  }
  doc.addEventListener("click", (event) => {
    const anchor = anchorFrom(event.target);
    if (!anchor) {
      return;
    }
    const link: NavigationLink = {
      href: anchor.href,
      target: anchor.getAttribute("target"),
      hasDownload: anchor.hasAttribute("download"),
    };
    const location = currentLocation();
    if (!shouldMarkNavigation(link, event, location.href)) {
      return;
    }
    try {
      onNavigate(new URL(link.href, location.href).pathname);
    } catch {
      /* unresolvable href: no intent */
    }
  });
}
