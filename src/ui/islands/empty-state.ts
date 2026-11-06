/**
 * Empty state shown when the document in view was closed from Recent.
 *
 * Closing unregisters the document in the daemon, but never touches the file
 * on disk; re-opening it is a terminal command (`md-preview <file>`), so the
 * state carries no "reopen" action.
 */

const CLOSED_CLASS = "mdprv-closed";

export function announce(message: string): void {
  const region = document.getElementById("mdprv-status");
  if (region) {
    region.textContent = message;
  }
}

export function showNoDocumentOpen(): void {
  const article = document.getElementById("mdprv-doc");
  const closedState = document.getElementById("mdprv-closed");
  const closedTitle = document.getElementById("mdprv-closed-title");
  if (!article || !closedState || !closedTitle) {
    return;
  }
  document.documentElement.classList.add(CLOSED_CLASS);
  article.hidden = true;
  closedState.hidden = false;
  announce("Document closed");
  closedTitle.focus();
}
