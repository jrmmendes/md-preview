import { getZoomSensitivity } from "../prefs";

interface MermaidConfigLike {
  theme?: string;
  themeVariables?: Record<string, string>;
}

interface MermaidPayload {
  mermaid: {
    light: MermaidConfigLike;
    dark: MermaidConfigLike;
  };
}

function readPayload(): MermaidPayload | null {
  const element = document.getElementById("mdprv-data");
  const raw = element?.textContent;
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as MermaidPayload;
  } catch {
    return null;
  }
}

function prefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/**
 * `data-theme` holds the theme *name* ("auto", "github-light", "nord", ...),
 * not a light/dark token. Only "auto" follows the OS; for fixed themes the
 * `color-scheme` emitted by the theme CSS is the source of truth.
 */
function effectiveScheme(): "light" | "dark" {
  const name = document.documentElement.getAttribute("data-theme") ?? "auto";
  if (name !== "auto") {
    const scheme =
      typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(document.documentElement).getPropertyValue("color-scheme")
        : "";
    if (scheme.includes("dark") && !scheme.includes("light")) {
      return "dark";
    }
    if (scheme.includes("light") && !scheme.includes("dark")) {
      return "light";
    }
  }
  return prefersDark() ? "dark" : "light";
}

export function initMermaidLightbox(): void {
  const data = readPayload();

  function config(): MermaidConfigLike {
    if (!data) {
      return {};
    }
    return effectiveScheme() === "dark" ? data.mermaid.dark : data.mermaid.light;
  }

  function decorate(): void {
    const pres = document.querySelectorAll<HTMLElement>("article pre.mermaid");
    pres.forEach((pre) => {
      if (!pre.querySelector("svg")) {
        return;
      }
      if (pre.querySelector(".mdprv-mermaid-fs")) {
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mdprv-mermaid-fs";
      button.setAttribute("aria-label", "View diagram full screen");
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
      button.addEventListener("click", () => {
        const svg = pre.querySelector("svg");
        if (svg) {
          openLightbox(svg as SVGSVGElement);
        }
      });
      pre.appendChild(button);
    });
  }

  let zoomElement: HTMLElement | null = null;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;

  const lightbox = document.getElementById("mdprv-mermaid-lightbox");
  const stage = document.getElementById("mdprv-mermaid-stage");
  const resetButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-reset") ?? null;
  const zoomInButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-in") ?? null;
  const zoomOutButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-out") ?? null;
  const closeButton = document.querySelector(".mdprv-mermaid-close");

  function applyZoom(): void {
    if (zoomElement) {
      zoomElement.style.transform = `translate(${translateX}px,${translateY}px) scale(${scale})`;
    }
    if (resetButton) {
      resetButton.textContent = Math.round(scale * 100) + "%";
    }
  }

  function setZoom(next: number): void {
    scale = Math.max(0.25, Math.min(8, next));
    applyZoom();
  }

  function sensitivity(): number {
    const stored = getZoomSensitivity();
    let value = stored ?? Number.parseFloat(document.documentElement.getAttribute("data-zoom-sensitivity") ?? "");
    if (!Number.isFinite(value)) {
      value = 1.1;
    }
    if (value <= 1) {
      value = 1.1;
    }
    if (value > 3) {
      value = 3;
    }
    return value;
  }

  function endDrag(): void {
    dragging = false;
    zoomElement?.classList.remove("mdprv-mermaid-pan");
    lightbox?.classList.remove("mdprv-mermaid-dragging");
  }

  function openLightbox(svg: SVGSVGElement): void {
    if (!lightbox || !stage || !svg) {
      return;
    }
    endDrag();
    stage.innerHTML = "";
    zoomElement = document.createElement("div");
    zoomElement.className = "mdprv-mermaid-zoom";
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const rect = svg.getBoundingClientRect();
    const width = rect.width || Number.parseFloat(svg.getAttribute("width") ?? "") || 300;
    const height = rect.height || Number.parseFloat(svg.getAttribute("height") ?? "") || 150;
    // Fit inside the stage content box so the stage padding keeps the diagram
    // away from the border.
    const stageStyle = window.getComputedStyle(stage);
    const padX =
      (Number.parseFloat(stageStyle.paddingLeft) || 0) +
      (Number.parseFloat(stageStyle.paddingRight) || 0);
    const padY =
      (Number.parseFloat(stageStyle.paddingTop) || 0) +
      (Number.parseFloat(stageStyle.paddingBottom) || 0);
    const availableWidth = Math.max(1, stage.clientWidth - padX);
    const availableHeight = Math.max(1, stage.clientHeight - padY);
    let fit = Math.min(availableWidth / width, availableHeight / height);
    if (!Number.isFinite(fit) || fit <= 0) {
      fit = 1;
    }
    if (fit > 4) {
      fit = 4;
    }
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.maxWidth = "none";
    clone.style.maxHeight = "none";
    clone.style.width = width * fit + "px";
    clone.style.height = height * fit + "px";
    zoomElement.appendChild(clone);
    stage.appendChild(zoomElement);
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyZoom();
    lightbox.dataset.scheme = effectiveScheme();
    lightbox.classList.add("mdprv-mermaid-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("mdprv-mermaid-lock");
  }

  function closeLightbox(): void {
    if (!lightbox) {
      return;
    }
    endDrag();
    lightbox.classList.remove("mdprv-mermaid-open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mdprv-mermaid-lock");
    if (stage) {
      stage.innerHTML = "";
    }
    zoomElement = null;
  }

  if (lightbox) {
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox) {
        closeLightbox();
      }
    });
    lightbox.addEventListener(
      "wheel",
      (event) => {
        if (!lightbox.classList.contains("mdprv-mermaid-open")) {
          return;
        }
        event.preventDefault();
        const step = sensitivity();
        setZoom(event.deltaY < 0 ? scale * step : scale / step);
      },
      { passive: false }
    );
  }

  closeButton?.addEventListener("click", closeLightbox);

  zoomInButton?.addEventListener("click", () => setZoom(scale * 1.25));
  zoomOutButton?.addEventListener("click", () => setZoom(scale / 1.25));
  resetButton?.addEventListener("click", () => {
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyZoom();
  });

  if (stage) {
    stage.addEventListener("pointerdown", (event) => {
      if (!zoomElement || event.button !== 0) {
        return;
      }
      dragging = true;
      startX = event.clientX - translateX;
      startY = event.clientY - translateY;
      zoomElement.classList.add("mdprv-mermaid-pan");
      lightbox?.classList.add("mdprv-mermaid-dragging");
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      // Prevent the browser from starting a native text selection on the SVG
      // labels and drop any selection that predates the gesture.
      event.preventDefault();
      window.getSelection()?.removeAllRanges();
    });

    stage.addEventListener("pointermove", (event) => {
      if (!dragging) {
        return;
      }
      event.preventDefault();
      translateX = event.clientX - startX;
      translateY = event.clientY - startY;
      applyZoom();
    });

    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);
    stage.addEventListener("lostpointercapture", endDrag);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLightbox();
    }
  });

  if (typeof mermaid !== "undefined") {
    try {
      mermaid.initialize(Object.assign({ startOnLoad: false, securityLevel: "strict" }, config()));
      const pending = mermaid.run({ querySelector: "pre.mermaid" });
      if (pending) {
        pending.then(decorate, decorate);
      } else {
        decorate();
      }
    } catch (error) {
      console.error("md-preview: mermaid", error);
      decorate();
    }
  }
}
