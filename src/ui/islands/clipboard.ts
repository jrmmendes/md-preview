/**
 * Clipboard helpers shared by the copy buttons (code blocks and diff blocks).
 *
 * `copyWithFeedback` keeps the existing UX: write through the async Clipboard
 * API when available, fall back to a hidden textarea, then swap the button to a
 * check icon for ~1200ms. The timer is tracked per button so repeated clicks do
 * not leave a stale restore queued.
 */

import { CHECK_ICON, COPY_ICON } from "../../shared/copy-icons";

const FEEDBACK_MS = 1200;

const timers = new WeakMap<HTMLElement, number>();

function fallbackCopy(text: string, done: () => void): void {
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
    if (copied) {
      done();
    }
  } catch {
    /* ignore */
  }
}

function copyText(text: string, done: () => void): void {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
      return;
    }
  } catch {
    /* ignore */
  }
  fallbackCopy(text, done);
}

/** Copy lazily-computed text and flash the check icon on `button`. */
export function copyWithFeedback(
  button: HTMLElement,
  getText: () => string,
  copiedClass = "mdprv-copied"
): void {
  copyText(getText(), () => {
    button.innerHTML = CHECK_ICON;
    button.classList.add(copiedClass);
    window.clearTimeout(timers.get(button));
    const timer = window.setTimeout(() => {
      button.innerHTML = COPY_ICON;
      button.classList.remove(copiedClass);
      timers.delete(button);
    }, FEEDBACK_MS);
    timers.set(button, timer);
  });
}
