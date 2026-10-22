import { setLoader } from "../prefs";
import * as loader from "../services/loader";

export function initLoaderOverlay(): void {
  loader.init();

  const select = document.getElementById("mdprv-loader") as HTMLSelectElement | null;
  if (select) {
    select.addEventListener("change", () => {
      loader.set(select.value);
      setLoader(loader.current());
      loader.preview(400);
    });
  }

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
