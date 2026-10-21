import { getCollapsed, getWidth, setCollapsed, setWidth, type CollapsedSide } from "../prefs";

const MIN_WIDTH = 28 * 16;

function setupWidth(): void {
  const root = document.documentElement;
  let width: number | null = null;

  function maxWidth(): number {
    return Math.max(MIN_WIDTH, window.innerWidth - 48);
  }

  function clamp(px: number): number {
    if (!Number.isFinite(px)) {
      return MIN_WIDTH;
    }
    if (px < MIN_WIDTH) {
      return MIN_WIDTH;
    }
    const max = maxWidth();
    return px > max ? max : px;
  }

  function apply(px: number): void {
    width = clamp(px);
    root.style.setProperty("--mdprv-content-width", width + "px");
  }

  const stored = getWidth();
  if (stored !== null) {
    apply(stored);
  }

  window.addEventListener("resize", () => {
    if (width !== null) {
      apply(width);
    }
  });

  const handles = [document.getElementById("mdprv-drag-left"), document.getElementById("mdprv-drag-right")].filter(
    (handle): handle is HTMLElement => handle !== null
  );

  function move(event: PointerEvent): void {
    apply(2 * Math.abs(event.clientX - window.innerWidth / 2));
  }

  function stop(): void {
    handles.forEach((handle) => handle.classList.remove("mdprv-dragging"));
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    if (width !== null) {
      setWidth(width);
    }
  }

  handles.forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      try {
        handle.setPointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      handles.forEach((item) => item.classList.add("mdprv-dragging"));
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    });
  });
}

function wireCollapse(side: CollapsedSide, classKey: string, buttonId: string): void {
  const root = document.documentElement;
  const button = document.getElementById(buttonId);

  if (getCollapsed(side)) {
    root.classList.add(classKey);
  }

  function sync(): void {
    const collapsed = root.classList.contains(classKey);
    if (button) {
      button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
  }

  sync();

  if (button) {
    button.addEventListener("click", () => {
      root.classList.toggle(classKey);
      setCollapsed(side, root.classList.contains(classKey));
      sync();
    });
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") {
    return true;
  }
  return target.isContentEditable;
}

function setupZen(): void {
  const root = document.documentElement;
  const button = document.getElementById("mdprv-zen-toggle");

  function sync(): void {
    if (!button) {
      return;
    }
    const on = root.classList.contains("mdprv-zen");
    button.setAttribute("aria-pressed", on ? "true" : "false");
    button.setAttribute("aria-label", on ? "Exit zen mode" : "Enter zen mode");
  }

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key !== "z" && event.key !== "Z") {
      return;
    }
    if (isEditable(event.target)) {
      return;
    }
    root.classList.toggle("mdprv-zen");
    sync();
  });

  if (button) {
    button.addEventListener("click", () => {
      root.classList.toggle("mdprv-zen");
      sync();
    });
  }

  sync();
}

function setupTop(): void {
  const button = document.getElementById("mdprv-top");
  if (!button) {
    return;
  }
  let ticking = false;

  function update(): void {
    ticking = false;
    if (window.scrollY > 300) {
      button?.classList.add("mdprv-top-visible");
    } else {
      button?.classList.remove("mdprv-top-visible");
    }
  }

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) {
        return;
      }
      ticking = true;
      window.requestAnimationFrame(update);
    },
    { passive: true }
  );

  update();

  button.addEventListener("click", () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      window.scrollTo(0, 0);
    }
  });
}

export function initLayout(): void {
  setupWidth();
  wireCollapse("left", "mdprv_left_collapsed", "mdprv-sidebar-toggle");
  wireCollapse("right", "mdprv_right_collapsed", "mdprv-history-toggle");
  setupZen();
  setupTop();
}
