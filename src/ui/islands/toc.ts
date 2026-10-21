export function initToc(): void {
  function buildToc(): void {
    const article = document.querySelector("article.markdown-body");
    const nav = document.getElementById("mdprv-toc");
    if (!article || !nav) {
      return;
    }

    const heads = Array.from(
      article.querySelectorAll<HTMLHeadingElement>("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")
    );
    if (heads.length === 0) {
      nav.style.display = "none";
      return;
    }

    let minLevel = 6;
    heads.forEach((heading) => {
      minLevel = Math.min(minLevel, Number.parseInt(heading.tagName.charAt(1), 10));
    });

    const list = document.createElement("ul");
    const links = new Map<string, HTMLAnchorElement>();

    heads.forEach((heading) => {
      const level = Number.parseInt(heading.tagName.charAt(1), 10);
      const item = document.createElement("li");
      const anchor = document.createElement("a");
      anchor.href = "#" + heading.id;
      anchor.textContent = heading.textContent;
      anchor.style.paddingLeft = (level - minLevel) * 12 + "px";
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        if (heading.scrollIntoView) {
          heading.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        if (window.history && history.replaceState) {
          history.replaceState(null, "", "#" + heading.id);
        }
      });
      links.set(heading.id, anchor);
      item.appendChild(anchor);
      list.appendChild(item);
    });

    nav.appendChild(list);

    if (typeof IntersectionObserver !== "undefined") {
      try {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) {
                return;
              }
              links.forEach((link) => link.classList.remove("active"));
              const active = links.get((entry.target as HTMLElement).id);
              if (active) {
                active.classList.add("active");
              }
            });
          },
          { rootMargin: "0px 0px -75% 0px", threshold: 0 }
        );
        heads.forEach((heading) => observer.observe(heading));
      } catch {
        /* observer unavailable: ignore */
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildToc);
  } else {
    buildToc();
  }
}
