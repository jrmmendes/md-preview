import * as loader from "../services/loader";

export function initLoaderOverlay(): void {
  loader.init();

  if (document.documentElement.getAttribute("data-loading") !== "1") {
    return;
  }

  loader.begin();
  if (document.readyState === "complete") {
    loader.settle();
  } else {
    window.addEventListener("load", () => loader.settle(), { once: true });
  }
}
