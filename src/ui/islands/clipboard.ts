/**
 * Clipboard helpers shared by the copy buttons (code blocks, diff blocks and
 * the full-screen media lightbox).
 *
 * `copyWithFeedback` keeps the existing UX: write through the async Clipboard
 * API when available, fall back to a hidden textarea, then swap the button to a
 * check icon for ~1200ms. The timer is tracked per button so repeated clicks do
 * not leave a stale restore queued.
 *
 * `flashCopied` / `flashCopyError` expose the same visual states to callers
 * that already produced an image (`ClipboardItem`) and only need the feedback.
 */

import { CHECK_ICON, COPY_ICON } from "../../shared/copy-icons";

const FEEDBACK_MS = 1200;

const timers = new WeakMap<HTMLElement, number>();

function fallbackCopy(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

/** Copy plain text, resolving only when the write really happened. */
export function copyText(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(resolve, () => {
          if (fallbackCopy(text)) {
            resolve();
          } else {
            reject(new Error("clipboard write failed"));
          }
        });
        return;
      }
    } catch {
      /* ignore */
    }
    if (fallbackCopy(text)) {
      resolve();
    } else {
      reject(new Error("clipboard write failed"));
    }
  });
}

function clearTimer(button: HTMLElement): void {
  window.clearTimeout(timers.get(button));
  timers.delete(button);
}

function armRestore(button: HTMLElement, run: () => void): void {
  clearTimer(button);
  const timer = window.setTimeout(() => {
    run();
    timers.delete(button);
  }, FEEDBACK_MS);
  timers.set(button, timer);
}

/** Swap a button to the check icon and tint it, then restore it. */
export function flashCopied(button: HTMLElement, copiedClass = "mdprv-copied"): void {
  button.innerHTML = CHECK_ICON;
  button.classList.add(copiedClass);
  armRestore(button, () => {
    button.innerHTML = COPY_ICON;
    button.classList.remove(copiedClass);
  });
}

/** Mark a copy attempt as failed (red tint + title) and restore it. */
export function flashCopyError(
  button: HTMLElement,
  message: string,
  restoredTitle?: string
): void {
  const previousTitle = button.title;
  button.classList.add("mdprv-copy-error");
  button.title = message;
  armRestore(button, () => {
    button.classList.remove("mdprv-copy-error");
    button.title = restoredTitle ?? previousTitle;
  });
}

/** Drop any pending feedback and restore the copy icon (opening/closing media). */
export function resetCopyFeedback(
  button: HTMLElement | null,
  copiedClass = "mdprv-copied"
): void {
  if (!button) {
    return;
  }
  clearTimer(button);
  button.classList.remove(copiedClass, "mdprv-copy-error");
  button.innerHTML = COPY_ICON;
}

/** Copy lazily-computed text and flash the check icon on `button`. */
export function copyWithFeedback(
  button: HTMLElement,
  getText: () => string,
  copiedClass = "mdprv-copied"
): void {
  copyText(getText()).then(
    () => flashCopied(button, copiedClass),
    () => {
      /* keep the existing silent failure behavior for code blocks */
    }
  );
}
