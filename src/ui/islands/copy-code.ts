import { COPY_ICON } from "../../shared/copy-icons";
import { copyWithFeedback } from "./clipboard";

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

  button.addEventListener("click", () => {
    copyWithFeedback(button, () => pre.innerText);
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
