import { getLoaderPending, setLoader, setLoaderPending } from "../prefs";
import * as loader from "../services/loader";

export function initLoaderOverlay(): void {
  loader.init();

  const select = document.getElementById("mdprv-loader") as HTMLSelectElement | null;
  if (select) {
    select.addEventListener("change", () => {
      loader.set(select.value);
      setLoader(loader.current());
      loader.flash(400);
    });
  }

  if (getLoaderPending()) {
    setLoaderPending(false);
    loader.show();
    if (document.readyState === "complete") {
      loader.settle();
    } else {
      window.addEventListener("load", () => loader.settle());
    }
  }
}
