import { COPY_ICON } from "../../shared/copy-icons";
import { fitScale, imageCopyMode } from "../../shared/lightbox";
import { getZoomSensitivity } from "../prefs";
import { copyText, flashCopied, flashCopyError, resetCopyFeedback } from "./clipboard";

interface MermaidConfigLike {
  theme?: string;
  themeVariables?: Record<string, string>;
  htmlLabels?: boolean;
}

interface MermaidPayload {
  mermaid: {
    light: MermaidConfigLike;
    dark: MermaidConfigLike;
  };
}

type Media =
  | { kind: "svg"; svg: SVGSVGElement; source: string }
  | { kind: "image"; src: string; alt: string; element: HTMLImageElement };

const FULLSCREEN_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';

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

/** Fullscreen affordance shared by diagrams and images. */
function fullscreenButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mdprv-mermaid-fs";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = FULLSCREEN_ICON;
  return button;
}

function isOnlyImageLink(anchor: HTMLAnchorElement, img: HTMLImageElement): boolean {
  const elements = anchor.querySelectorAll("*");
  if (elements.length !== 1 || elements[0] !== img) {
    return false;
  }
  for (const node of Array.from(anchor.childNodes)) {
    if (node === img) {
      continue;
    }
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() === "") {
      continue;
    }
    return false;
  }
  return true;
}

export function initLightbox(): void {
  const data = readPayload();

  function config(): MermaidConfigLike {
    if (!data) {
      return {};
    }
    return effectiveScheme() === "dark" ? data.mermaid.dark : data.mermaid.light;
  }

  // Mermaid replaces the fence content with the rendered SVG, so the original
  // source has to be captured before `mermaid.run` for the text fallback.
  const sources = new WeakMap<HTMLElement, string>();
  const pres = document.querySelectorAll<HTMLElement>("article pre.mermaid");
  pres.forEach((pre) => {
    sources.set(pre, pre.textContent ?? "");
  });

  let zoomElement: HTMLElement | null = null;
  let scale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let current: Media | null = null;
  let statusTimer = 0;

  const lightbox = document.getElementById("mdprv-mermaid-lightbox");
  const stage = document.getElementById("mdprv-mermaid-stage");
  const resetButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-reset") ?? null;
  const zoomInButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-in") ?? null;
  const zoomOutButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-out") ?? null;
  const copyButton = lightbox?.querySelector<HTMLButtonElement>(".mdprv-mermaid-copy") ?? null;
  const status = lightbox?.querySelector<HTMLElement>(".mdprv-mermaid-status") ?? null;
  const closeButton = document.querySelector(".mdprv-mermaid-close");

  if (copyButton) {
    copyButton.innerHTML = COPY_ICON;
  }

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
    let value =
      stored ?? Number.parseFloat(document.documentElement.getAttribute("data-zoom-sensitivity") ?? "");
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

  function setStatus(message: string, kind?: "error"): void {
    if (!status) {
      return;
    }
    status.textContent = message;
    if (kind) {
      status.dataset.kind = kind;
    } else {
      delete status.dataset.kind;
    }
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      status.textContent = "";
      delete status.dataset.kind;
    }, 1800);
  }

  function clearStatus(): void {
    if (status) {
      status.textContent = "";
      delete status.dataset.kind;
    }
    window.clearTimeout(statusTimer);
  }

  function stageContentBox(): { width: number; height: number } {
    if (!stage) {
      return { width: 0, height: 0 };
    }
    const style = window.getComputedStyle(stage);
    const padX =
      (Number.parseFloat(style.paddingLeft) || 0) +
      (Number.parseFloat(style.paddingRight) || 0);
    const padY =
      (Number.parseFloat(style.paddingTop) || 0) +
      (Number.parseFloat(style.paddingBottom) || 0);
    return {
      width: Math.max(1, stage.clientWidth - padX),
      height: Math.max(1, stage.clientHeight - padY),
    };
  }

  function svgIntrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
    const viewBox = svg.viewBox?.baseVal;
    if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
      return { width: viewBox.width, height: viewBox.height };
    }
    const rect = svg.getBoundingClientRect();
    return {
      width: rect.width || Number.parseFloat(svg.getAttribute("width") ?? "") || 300,
      height: rect.height || Number.parseFloat(svg.getAttribute("height") ?? "") || 150,
    };
  }

  function refreshCopyButton(): void {
    if (!copyButton) {
      return;
    }
    resetCopyFeedback(copyButton);
    copyButton.disabled = current === null;
    const label = current?.kind === "image" ? "Copy image" : "Copy diagram as image";
    copyButton.setAttribute("aria-label", label);
    copyButton.title = label;
  }

  function openMedia(media: Media): void {
    if (!lightbox || !stage) {
      return;
    }
    endDrag();
    stage.innerHTML = "";
    clearStatus();
    zoomElement = document.createElement("div");
    zoomElement.className = "mdprv-mermaid-zoom";
    const available = stageContentBox();

    if (media.kind === "svg") {
      const clone = media.svg.cloneNode(true) as SVGSVGElement;
      const { width, height } = svgIntrinsicSize(media.svg);
      const fit = fitScale(available.width, available.height, width, height, 4);
      clone.removeAttribute("width");
      clone.removeAttribute("height");
      clone.style.maxWidth = "none";
      clone.style.maxHeight = "none";
      clone.style.width = width * fit + "px";
      clone.style.height = height * fit + "px";
      zoomElement.appendChild(clone);
    } else {
      const image = document.createElement("img");
      image.src = media.src;
      image.alt = media.alt;
      image.decoding = "async";
      const rect = media.element.getBoundingClientRect();
      const width = media.element.naturalWidth || rect.width;
      const height = media.element.naturalHeight || rect.height;
      const fit = fitScale(available.width, available.height, width, height, 1);
      if (width > 0 && height > 0) {
        image.style.width = width * fit + "px";
        image.style.height = height * fit + "px";
      }
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      zoomElement.appendChild(image);
    }

    stage.appendChild(zoomElement);
    current = media;
    scale = 1;
    translateX = 0;
    translateY = 0;
    applyZoom();
    refreshCopyButton();
    lightbox.dataset.scheme = effectiveScheme();
    lightbox.dataset.kind = media.kind;
    lightbox.setAttribute(
      "aria-label",
      media.kind === "image" ? media.alt || "Image full screen" : "Mermaid diagram full screen"
    );
    lightbox.classList.add("mdprv-mermaid-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("mdprv-mermaid-lock");
  }

  function openImage(element: HTMLImageElement): void {
    const reveal = () => {
      openMedia({
        kind: "image",
        src: element.currentSrc || element.src,
        alt: element.alt || "",
        element,
      });
    };
    // Wait for natural dimensions when possible so the initial fit is exact
    // instead of collapsing to the (possibly zero-sized) rendered box.
    if (!element.complete) {
      element.decode().then(reveal, reveal);
      return;
    }
    reveal();
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
    current = null;
    resetCopyFeedback(copyButton);
    clearStatus();
  }

  function decorateMermaid(): void {
    pres.forEach((pre) => {
      if (!pre.querySelector("svg")) {
        return;
      }
      if (pre.querySelector(".mdprv-mermaid-fs")) {
        return;
      }
      const button = fullscreenButton("View diagram full screen");
      button.addEventListener("click", () => {
        const svg = pre.querySelector("svg");
        if (svg) {
          openMedia({ kind: "svg", svg: svg as SVGSVGElement, source: sources.get(pre) ?? "" });
        }
      });
      pre.appendChild(button);
    });
  }

  function decorateImage(image: HTMLImageElement): void {
    if (image.closest(".mdprv-mermaid-lightbox, .mdprv-mermaid-stage, pre, button, .mdprv-image")) {
      return;
    }
    if (image.dataset.mdprvLightbox === "1") {
      return;
    }
    // Decorative images: empty alt (explicit and implicit) and ARIA opt-outs.
    if (image.getAttribute("alt") === "") {
      return;
    }
    if (
      image.getAttribute("role") === "presentation" ||
      image.getAttribute("aria-hidden") === "true" ||
      image.dataset.noLightbox !== undefined
    ) {
      return;
    }
    const parent = image.parentElement;
    if (!parent) {
      return;
    }

    const host =
      parent.tagName === "PICTURE"
        ? parent
        : parent.tagName === "A" && isOnlyImageLink(parent as HTMLAnchorElement, image)
          ? parent
          : image;
    const wrapper = document.createElement("span");
    wrapper.className = "mdprv-image";
    host.parentNode?.insertBefore(wrapper, host);
    wrapper.appendChild(host);

    const label = image.alt ? `View image full screen: ${image.alt}` : "View image full screen";
    const button = fullscreenButton(label);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImage(image);
    });
    wrapper.appendChild(button);
    image.dataset.mdprvLightbox = "1";
  }

  function decorateImages(): void {
    document
      .querySelectorAll<HTMLImageElement>("article.markdown-body img")
      .forEach((image) => decorateImage(image));
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

  copyButton?.addEventListener("click", () => {
    void copyCurrent();
  });

  async function copyCurrent(): Promise<void> {
    if (!lightbox || !copyButton || !current) {
      return;
    }
    const media = current;
    if (media.kind === "image") {
      try {
        const blob = await imageToPngBlob(media);
        await writeClipboardPng(blob);
        if (current !== media) {
          return;
        }
        flashCopied(copyButton);
        setStatus("Image copied");
      } catch {
        if (current !== media) {
          return;
        }
        const message = "Could not copy image (CORS or network)";
        flashCopyError(copyButton, message, "Copy image");
        setStatus(message, "error");
      }
      return;
    }
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        throw new Error("image clipboard unsupported");
      }
      const blob = await diagramToPngBlob(media);
      await writeClipboardPng(blob);
      if (current !== media) {
        return;
      }
      flashCopied(copyButton);
      setStatus("Image copied");
    } catch {
      try {
        await copyText(media.source);
        if (current !== media) {
          return;
        }
        flashCopied(copyButton);
        copyButton.title = "Code copied";
        setStatus("Code copied");
      } catch {
        if (current !== media) {
          return;
        }
        const message = "Could not copy diagram";
        flashCopyError(copyButton, message, "Copy diagram as image");
        setStatus(message, "error");
      }
    }
  }

  function themeBackground(): string {
    const fromTheme = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue("--mdprv-bg")
      .trim();
    if (fromTheme) {
      return fromTheme;
    }
    return config().themeVariables?.background || "#ffffff";
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("image decode failed"));
      image.src = src;
    });
  }

  function drawToPng(
    source: CanvasImageSource,
    width: number,
    height: number,
    background: string | null
  ): Promise<Blob> {
    const canvas = document.createElement("canvas");
    // Keep the native pixel dimensions: the clipboard copy should match the
    // source image/viewBox, not the current zoom or the device pixel ratio.
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) {
      return Promise.reject(new Error("canvas unavailable"));
    }
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("png encode failed"));
        }
      }, "image/png");
    });
  }

  async function svgToPngBlob(svg: SVGSVGElement): Promise<Blob> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const { width, height } = svgIntrinsicSize(svg);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.style.maxWidth = "none";
    clone.style.maxHeight = "none";
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = await loadImage(url);
      return await drawToPng(image, width, height, themeBackground());
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function diagramToPngBlob(media: Extract<Media, { kind: "svg" }>): Promise<Blob> {
    // Mermaid's HTML labels are <foreignObject>: drawing that SVG into a canvas
    // taints it in Chromium, so `toBlob` throws. Re-render the same source with
    // SVG <text> labels (same theme) only for the export path; the on-screen
    // diagram keeps its original HTML labels.
    if (media.svg.querySelector("foreignObject")) {
      const rendered = await renderForExport(media.source);
      if (rendered) {
        return svgToPngBlob(rendered);
      }
    }
    return svgToPngBlob(media.svg);
  }

  async function renderForExport(source: string): Promise<SVGSVGElement | null> {
    if (
      !source.trim() ||
      typeof mermaid === "undefined" ||
      typeof mermaid.render !== "function"
    ) {
      return null;
    }
    const base = Object.assign({ startOnLoad: false, securityLevel: "strict" }, config());
    mermaid.initialize(Object.assign({}, base, { htmlLabels: false }));
    try {
      const result = await mermaid.render(`mdprv-export-${Date.now()}`, source);
      const holder = document.createElement("div");
      holder.innerHTML = result.svg;
      const svg = holder.querySelector("svg");
      if (svg && !svg.querySelector("foreignObject")) {
        return svg;
      }
      return null;
    } catch {
      return null;
    } finally {
      mermaid.initialize(base);
    }
  }

  async function imageToPngBlob(media: Extract<Media, { kind: "image" }>): Promise<Blob> {
    const src = media.src;
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) {
      throw new Error(`image fetch failed: ${response.status}`);
    }
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (imageCopyMode(blob.type, bytes) === "png") {
      return new Blob([bytes], { type: "image/png" });
    }
    const url = URL.createObjectURL(blob);
    try {
      const image = await loadImage(url);
      const rect = media.element.getBoundingClientRect();
      const width = image.naturalWidth || media.element.naturalWidth || rect.width;
      const height = image.naturalHeight || media.element.naturalHeight || rect.height;
      if (!(width > 0) || !(height > 0)) {
        throw new Error("image has no dimensions");
      }
      const mime = blob.type.split(";")[0]!.trim().toLowerCase();
      // Rasterized SVGs get the theme background; JPEG/WebP keep their pixels.
      const background = mime === "image/svg+xml" || mime === "" ? themeBackground() : null;
      return await drawToPng(image, width, height, background);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function writeClipboardPng(blob: Blob): Promise<void> {
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      throw new Error("image clipboard unsupported");
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  }

  // Decorate images immediately; Mermaid diagrams only after `run` resolves.
  decorateImages();

  if (typeof mermaid !== "undefined") {
    try {
      mermaid.initialize(Object.assign({ startOnLoad: false, securityLevel: "strict" }, config()));
      const pending = mermaid.run({ querySelector: "pre.mermaid" });
      if (pending) {
        pending.then(decorateMermaid, decorateMermaid);
      } else {
        decorateMermaid();
      }
    } catch (error) {
      console.error("md-preview: mermaid", error);
      decorateMermaid();
    }
  }
}
