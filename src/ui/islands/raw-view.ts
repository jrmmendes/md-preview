/**
 * "Raw" / "Copy raw" controls for the document source.
 *
 * The Markdown source (frontmatter included) travels in the `#mdprv-data`
 * payload, never in the rendered body, so the preview keeps its no-frontmatter
 * HTML contract. This island toggles between the rendered article and a plain
 * text view, copies the exact same text and steps aside in zen mode.
 */

import { COPY_ICON } from "../../shared/copy-icons";
import { copyWithFeedback } from "./clipboard";

const ROOT = document.documentElement;
const OPEN_CLASS = "mdprv-raw-open";
const VISIBLE_CLASS = "mdprv-raw-visible";
const ZEN_CLASS = "mdprv-zen";

interface PagePayload {
  raw?: unknown;
}

function readRaw(): string {
  const element = document.getElementById("mdprv-data");
  const text = element?.textContent;
  if (!text) {
    return "";
  }
  try {
    const payload = JSON.parse(text) as PagePayload;
    return typeof payload.raw === "string" ? payload.raw : "";
  } catch {
    return "";
  }
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function initRawView(): void {
  function run(): void {
    const toggle = document.getElementById("mdprv-raw-toggle");
    const copyButton = document.getElementById("mdprv-raw-copy");
    const copyIcon = document.getElementById("mdprv-raw-copy-icon");
    const section = document.getElementById("mdprv-raw");
    const code = document.getElementById("mdprv-raw-code");

    if (
      !(toggle instanceof HTMLButtonElement) ||
      !(copyButton instanceof HTMLButtonElement) ||
      !(section instanceof HTMLElement) ||
      !(code instanceof HTMLElement)
    ) {
      return;
    }

    const raw = readRaw();
    code.textContent = raw;

    if (copyIcon) {
      copyIcon.innerHTML = COPY_ICON;
    }

    let open = false;
    let hideTimer = 0;
    let highlightStarted = false;

    const syncAria = (): void => {
      toggle?.setAttribute("aria-pressed", open ? "true" : "false");
      toggle?.setAttribute("aria-expanded", open ? "true" : "false");
    };

    function rawSlug(): string {
      const path = window.location.pathname.replace(/^\/+/, "");
      try {
        return decodeURIComponent(path);
      } catch {
        return path;
      }
    }

    // Reuse the server Shiki pipeline on demand instead of shipping the
    // highlighter (and its grammars/wasm) to every page load.
    const applyHighlight = (html: string): void => {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const pre = parsed.querySelector<HTMLElement>("pre.shiki");
      const source = pre?.querySelector("code");
      if (!pre || !source) {
        return;
      }
      for (const name of ["--shiki-light", "--shiki-dark"]) {
        const value = pre.style.getPropertyValue(name);
        if (value) {
          code.style.setProperty(name, value);
        }
      }
      code.classList.add("shiki");
      code.innerHTML = source.innerHTML;
    };

    const highlight = (): void => {
      if (highlightStarted) {
        return;
      }
      highlightStarted = true;
      const params = new URLSearchParams({ slug: rawSlug() });
      const theme = ROOT.getAttribute("data-theme");
      if (theme) {
        params.set("theme", theme);
      }
      fetch("/__raw-highlight?" + params.toString(), {
        headers: { Accept: "text/html" },
      })
        .then((response) => (response.ok ? response.text() : ""))
        .then((html) => {
          if (html) {
            applyHighlight(html);
          } else {
            highlightStarted = false;
          }
        })
        .catch(() => {
          // Keep the plain source visible and allow a retry on the next open.
          highlightStarted = false;
        });
    };

    const show = (): void => {
      window.clearTimeout(hideTimer);
      ROOT.classList.add(OPEN_CLASS);
      section.hidden = false;
      // Flush the hidden state so the fade/slide transition always starts.
      void section.offsetWidth;
      section.classList.add(VISIBLE_CLASS);
      highlight();
    };

    const hide = (): void => {
      section.classList.remove(VISIBLE_CLASS);
      window.clearTimeout(hideTimer);
      const finish = (): void => {
        section.hidden = true;
        ROOT.classList.remove(OPEN_CLASS);
      };
      if (reducedMotion()) {
        finish();
      } else {
        hideTimer = window.setTimeout(finish, 240);
      }
    };

    const apply = (next: boolean): void => {
      open = next && !ROOT.classList.contains(ZEN_CLASS);
      if (open) {
        show();
      } else {
        hide();
      }
      syncAria();
    };

    toggle.addEventListener("click", () => {
      apply(!open);
    });

    copyButton.addEventListener("click", () => {
      copyWithFeedback(copyIcon ?? copyButton, () => raw);
    });

    // Zen can be toggled from the button or the "z" shortcut, both of which
    // only touch the root class list.
    const observer = new MutationObserver(() => {
      if (ROOT.classList.contains(ZEN_CLASS) && open) {
        apply(false);
      }
    });
    observer.observe(ROOT, { attributes: true, attributeFilter: ["class"] });

    syncAria();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
}
