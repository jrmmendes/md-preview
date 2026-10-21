const COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';

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

function setup(pre: HTMLElement): void {
  if (!pre.parentNode) {
    return;
  }
  const parent = pre.parentElement;
  if (parent && parent.classList.contains("mdprv-code")) {
    return;
  }

  const box = document.createElement("div");
  box.className = "mdprv-code";
  pre.parentNode.insertBefore(box, pre);
  box.appendChild(pre);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "mdprv-copy";
  button.setAttribute("aria-label", "Copy code");
  button.innerHTML = COPY_ICON;
  let timer: number | undefined;

  button.addEventListener("click", () => {
    copyText(pre.innerText, () => {
      button.innerHTML = CHECK_ICON;
      button.classList.add("mdprv-copied");
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        button.innerHTML = COPY_ICON;
        button.classList.remove("mdprv-copied");
      }, 1200);
    });
  });

  box.appendChild(button);
}

export function initCopyCode(): void {
  function run(): void {
    const article = document.querySelector("article.markdown-body");
    if (!article) {
      return;
    }
    article.querySelectorAll<HTMLElement>("pre:not(.mermaid)").forEach(setup);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
}
