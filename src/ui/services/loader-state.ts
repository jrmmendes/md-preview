export const MIN_VISIBLE_MS = 180;
export const FONTS_CAP_MS = 600;
export const ABSOLUTE_TIMEOUT_MS = 8_000;

type TimerHandle = number;

export interface LoaderStateOptions {
  now?: () => number;
  setTimer?: (callback: () => void, delay: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
  onChange?: (visible: boolean) => void;
}

export interface LoaderState {
  begin(): void;
  markLoaded(): void;
  markFontsReady(): void;
  hide(): void;
  preview(ms: number): void;
  pageShow(persisted: boolean): void;
  visible(): boolean;
}

export function createLoaderState(options: LoaderStateOptions = {}): LoaderState {
  const now = options.now ?? (() => Date.now());
  const setTimer =
    options.setTimer ??
    ((callback, delay) => globalThis.setTimeout(callback, delay) as unknown as TimerHandle);
  const clearTimer =
    options.clearTimer ??
    ((handle) =>
      globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
  const onChange = options.onChange ?? (() => {});

  let visible = false;
  let active = false;
  let loaded = false;
  let fontsReady = false;
  let startedAt = 0;
  let hideTimer: TimerHandle | null = null;
  let deadlineTimer: TimerHandle | null = null;
  let fontsCapTimer: TimerHandle | null = null;
  let previewTimer: TimerHandle | null = null;

  function clear(handle: TimerHandle | null): null {
    if (handle !== null) {
      clearTimer(handle);
    }
    return null;
  }

  function setVisible(next: boolean): void {
    if (visible === next) {
      return;
    }
    visible = next;
    onChange(next);
  }

  function maybeSettle(): void {
    if (!active || !loaded || !fontsReady || hideTimer !== null) {
      return;
    }
    const remaining = MIN_VISIBLE_MS - (now() - startedAt);
    hideTimer = setTimer(() => {
      hideTimer = null;
      hide();
    }, Math.max(0, remaining));
  }

  function begin(): void {
    if (active) {
      return;
    }
    active = true;
    loaded = false;
    fontsReady = false;
    startedAt = now();
    hideTimer = clear(hideTimer);
    previewTimer = clear(previewTimer);
    deadlineTimer = clear(deadlineTimer);
    fontsCapTimer = clear(fontsCapTimer);
    setVisible(true);
    deadlineTimer = setTimer(() => {
      deadlineTimer = null;
      hide();
    }, ABSOLUTE_TIMEOUT_MS);
    fontsCapTimer = setTimer(() => {
      fontsCapTimer = null;
      markFontsReady();
    }, FONTS_CAP_MS);
  }

  function markLoaded(): void {
    if (!active) {
      return;
    }
    loaded = true;
    maybeSettle();
  }

  function markFontsReady(): void {
    if (!active || fontsReady) {
      return;
    }
    fontsCapTimer = clear(fontsCapTimer);
    fontsReady = true;
    maybeSettle();
  }

  function hide(): void {
    hideTimer = clear(hideTimer);
    deadlineTimer = clear(deadlineTimer);
    fontsCapTimer = clear(fontsCapTimer);
    previewTimer = clear(previewTimer);
    active = false;
    loaded = false;
    fontsReady = false;
    setVisible(false);
  }

  function preview(ms: number): void {
    if (active) {
      return;
    }
    previewTimer = clear(previewTimer);
    setVisible(true);
    previewTimer = setTimer(() => {
      previewTimer = null;
      hide();
    }, Math.max(0, ms));
  }

  function pageShow(persisted: boolean): void {
    if (persisted) {
      hide();
    }
  }

  return {
    begin,
    markLoaded,
    markFontsReady,
    hide,
    preview,
    pageShow,
    visible: () => visible,
  };
}
