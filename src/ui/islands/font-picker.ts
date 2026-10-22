import type { FontInfo } from "../../core/contract";
import { getFontSelection, setFontSelection, type FontSelection } from "../prefs";
import { searchFonts } from "../services/font-search";
import { fontStack, sanitizeFamily } from "../services/font-value";
import {
  applySelection,
  fetchFonts,
  loadGoogleFamily,
  resetSelection,
} from "../services/fonts";

const MAX_OPTIONS = 80;

function optionId(index: number): string {
  return `mdprv-font-option-${index}`;
}

export function initFontPicker(): void {
  const inputElement = document.getElementById("mdprv-font") as HTMLInputElement | null;
  const listElement = document.getElementById("mdprv-font-list") as HTMLUListElement | null;
  const picker = document.getElementById("mdprv-font-picker");
  const statusElement = document.getElementById("mdprv-font-status");
  const refreshButton = document.getElementById("mdprv-font-refresh") as HTMLButtonElement | null;
  const resetButton = document.getElementById("mdprv-font-reset") as HTMLButtonElement | null;
  const googleInput = document.getElementById(
    "mdprv-font-google-family"
  ) as HTMLInputElement | null;
  const googleButton = document.getElementById(
    "mdprv-font-google-load"
  ) as HTMLButtonElement | null;
  const googleError = document.getElementById("mdprv-font-google-error");

  if (!inputElement || !listElement || !statusElement) {
    return;
  }
  const input: HTMLInputElement = inputElement;
  const list: HTMLUListElement = listElement;
  const status: HTMLElement = statusElement;

  let fonts: FontInfo[] = [];
  let filtered: FontInfo[] = [];
  let active = -1;
  let open = false;
  let loading = false;
  let available = false;
  let selected: FontSelection | null = getFontSelection();

  if (selected) {
    input.value = selected.family;
    applySelection(selected);
  }

  function setStatus(message: string): void {
    status.textContent = message;
  }

  function updateStatus(): void {
    if (loading) {
      setStatus("Loading fonts…");
      return;
    }
    const query = input.value.trim();
    if (open && query !== "") {
      if (filtered.length === 0) {
        setStatus(`No fonts match “${query}”.`);
        return;
      }
      setStatus(`${filtered.length} matching ${filtered.length === 1 ? "font" : "fonts"}.`);
      return;
    }
    if (fonts.length === 0) {
      setStatus("Fonts unavailable.");
      return;
    }
    if (!available) {
      setStatus("Font catalog unavailable; showing generic families.");
      return;
    }
    setStatus(`${fonts.length} fonts.`);
  }

  function setActive(index: number, scroll: boolean): void {
    active = index;
    const options = list.querySelectorAll<HTMLElement>('[role="option"]');
    options.forEach((option, position) => {
      option.classList.toggle("mdprv-font-option-active", position === index);
    });
    const current = options[index];
    if (current) {
      input.setAttribute("aria-activedescendant", current.id);
      if (scroll) {
        current.scrollIntoView({ block: "nearest" });
      }
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(): void {
    if (!open) {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      updateStatus();
      return;
    }

    filtered = searchFonts(fonts, input.value, MAX_OPTIONS);
    list.textContent = "";
    const fragment = document.createDocumentFragment();
    filtered.forEach((font, index) => {
      const option = document.createElement("li");
      option.id = optionId(index);
      option.className = "mdprv-font-option";
      option.setAttribute("role", "option");
      option.setAttribute(
        "aria-selected",
        selected && selected.family.toLowerCase() === font.family.toLowerCase() ? "true" : "false"
      );
      option.setAttribute("data-family", font.family);

      const name = document.createElement("span");
      name.className = "mdprv-font-name";
      name.textContent = font.family;

      const preview = document.createElement("span");
      preview.className = "mdprv-font-preview";
      preview.textContent = "Aa Bb Cc 0123";
      preview.style.fontFamily = fontStack(font.family);

      option.append(name, preview);
      fragment.appendChild(option);
    });
    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "mdprv-font-empty";
      empty.setAttribute("role", "presentation");
      empty.textContent = "No matching fonts";
      fragment.appendChild(empty);
    }
    list.appendChild(fragment);
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");

    if (active >= filtered.length) {
      active = filtered.length - 1;
    }
    if (active < 0 && filtered.length > 0) {
      active = 0;
    }
    setActive(active, false);
    updateStatus();
  }

  function openList(): void {
    if (!open) {
      open = true;
      active = filtered.length > 0 ? 0 : -1;
    }
    render();
  }

  function closeList(): void {
    if (!open) {
      return;
    }
    open = false;
    active = -1;
    render();
  }

  function selectFont(font: FontInfo): void {
    const selection = setFontSelection({
      family: font.family,
      source: "local",
      stack: fontStack(font.family),
    });
    if (!selection) {
      return;
    }
    selected = selection;
    applySelection(selection);
    input.value = selection.family;
    closeList();
  }

  async function load(force: boolean): Promise<void> {
    loading = true;
    if (refreshButton) {
      refreshButton.disabled = true;
    }
    updateStatus();
    try {
      const payload = await fetchFonts(force);
      fonts = payload.fonts;
      available = payload.available;
    } finally {
      loading = false;
      if (refreshButton) {
        refreshButton.disabled = false;
      }
      render();
    }
  }

  input.addEventListener("focus", openList);
  input.addEventListener("click", openList);
  input.addEventListener("input", () => {
    open = true;
    active = 0;
    render();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (filtered.length === 0) {
        return;
      }
      active = active < 0 ? 0 : (active + 1) % filtered.length;
      setActive(active, true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (filtered.length === 0) {
        return;
      }
      active = (active - 1 + filtered.length) % filtered.length;
      setActive(active, true);
      return;
    }
    if (event.key === "Home" && open) {
      event.preventDefault();
      setActive(0, true);
      return;
    }
    if (event.key === "End" && open) {
      event.preventDefault();
      setActive(filtered.length - 1, true);
      return;
    }
    if (event.key === "Enter" && open) {
      const font = filtered[active];
      if (font) {
        event.preventDefault();
        selectFont(font);
      }
      return;
    }
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        input.value = selected?.family ?? "";
        closeList();
      }
      return;
    }
    if (event.key === "Tab") {
      closeList();
    }
  });
  input.addEventListener("blur", () => {
    window.setTimeout(() => {
      const focused = document.activeElement;
      if (!picker || !focused || !picker.contains(focused)) {
        closeList();
      }
    }, 0);
  });

  list.addEventListener("pointerdown", (event) => {
    const target = event.target as Element | null;
    const option = target?.closest('[role="option"]') as HTMLElement | null;
    if (!option) {
      return;
    }
    event.preventDefault();
    const family = option.getAttribute("data-family");
    const font = family ? fonts.find((entry) => entry.family === family) : undefined;
    if (font) {
      selectFont(font);
    }
    input.focus();
  });

  refreshButton?.addEventListener("click", () => {
    void load(true);
  });

  resetButton?.addEventListener("click", () => {
    selected = null;
    resetSelection();
    input.value = "";
    closeList();
    updateStatus();
  });

  async function loadGoogle(): Promise<void> {
    if (!googleInput || !googleButton) {
      return;
    }
    const family = sanitizeFamily(googleInput.value);
    if (!family) {
      if (googleError) {
        googleError.textContent = "Enter a valid font family name.";
        googleError.hidden = false;
      }
      return;
    }
    googleButton.disabled = true;
    if (googleError) {
      googleError.hidden = true;
    }
    try {
      selected = await loadGoogleFamily(family);
      input.value = selected.family;
      googleInput.value = selected.family;
      closeList();
      setStatus(`Loaded “${selected.family}” from Google Fonts.`);
    } catch (error) {
      if (googleError) {
        const timedOut = error instanceof Error && error.message === "google-font-timeout";
        googleError.textContent = timedOut
          ? "Could not load this font: the request timed out."
          : "Could not load this font from Google Fonts. Check the name and try again.";
        googleError.hidden = false;
      }
    } finally {
      googleButton.disabled = false;
    }
  }

  googleButton?.addEventListener("click", () => {
    void loadGoogle();
  });
  googleInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void loadGoogle();
    }
  });

  void load(false);
}
