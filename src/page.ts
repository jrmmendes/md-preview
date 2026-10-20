import { getTheme, themeNames, type PageVars, type ThemeDef } from "./themes";

export interface PageInput {
  title: string;
  body: string;
  themeName: string;
  loader?: string;
  zoomSensitivity?: number;
  meta?: Record<string, unknown>;
}

const LOADERS = ["classic", "dots", "bars", "ring", "pulse", "braille"] as const;
const DEFAULT_LOADER = "classic";

function resolveLoaderName(name: string | undefined): string {
  return name && (LOADERS as readonly string[]).includes(name) ? name : DEFAULT_LOADER;
}

const DEFAULT_ZOOM_SENSITIVITY = 1.1;

function resolveZoomSensitivity(value: number | undefined): number {
  const n = Number(value);
  if (!isFinite(n) || n <= 1) {
    return DEFAULT_ZOOM_SENSITIVITY;
  }
  return Math.min(n, 3);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function metaValueHtml(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const text =
          typeof item === "object" && item !== null ? JSON.stringify(item) : String(item);
        return `<span class="mdprv-tag">${escapeHtml(text)}</span>`;
      })
      .join(" ");
  }
  if (typeof value === "object") {
    return `<code>${escapeHtml(JSON.stringify(value))}</code>`;
  }
  return escapeHtml(String(value));
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function renderMeta(meta: Record<string, unknown> | undefined): string {
  if (!meta) {
    return "";
  }
  const keys = Object.keys(meta);
  if (keys.length === 0) {
    return "";
  }
  const summary = hasValue(meta.date)
    ? String(meta.date)
    : hasValue(meta.title)
      ? String(meta.title)
      : "Metadata";
  const rows = keys
    .map((key) => `<dt>${escapeHtml(key)}</dt><dd>${metaValueHtml(meta[key])}</dd>`)
    .join("");
  return `<details class="mdprv-meta-card"><summary>${escapeHtml(summary)}</summary><dl>${rows}</dl></details>`;
}

function rootVars(v: PageVars): string {
  return [
    `--mdprv-bg:${v.bg}`,
    `--mdprv-fg:${v.fg}`,
    `--mdprv-muted:${v.muted}`,
    `--mdprv-link:${v.link}`,
    `--mdprv-border:${v.border}`,
    `--mdprv-code-bg:${v.codeBg}`,
    `--mdprv-quote:${v.blockquote}`,
  ].join(";");
}

function themeCss(theme: ThemeDef): string {
  if (theme.kind === "auto" && theme.light && theme.dark) {
    return [
      `:root{${rootVars(theme.light)}}`,
      `@media (prefers-color-scheme: dark){:root{${rootVars(theme.dark)}}}`,
    ].join("\n");
  }
  if (theme.vars) {
    return `:root{${rootVars(theme.vars)}}`;
  }
  return "";
}

const BASE_CSS = `:root{color-scheme:light dark;--mdprv-content-width:46rem;--mdprv-code-line-height:1;--mdprv-sidebar-width:16rem;--mdprv-scroll-offset:7rem;--mdprv-ui-dur:.18s}
*{box-sizing:border-box}
body{margin:0;padding:0;font-family:var(--mdprv-font,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif);font-size:17px;line-height:1.65;color:var(--mdprv-fg);background:var(--mdprv-bg);word-wrap:break-word}
article.markdown-body{max-width:var(--mdprv-content-width);margin:0 auto;padding:2.5rem 1.25rem 6rem}
h1,h2,h3,h4,h5,h6{margin:1.8em 0 .6em;line-height:1.25;font-weight:600;scroll-margin-top:var(--mdprv-scroll-offset)}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid var(--mdprv-border)}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid var(--mdprv-border)}
h3{font-size:1.25em}
p{margin:0 0 1em}
a{color:var(--mdprv-link);text-decoration:none}
a:hover{text-decoration:underline}
code{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:.88em;background:var(--mdprv-code-bg);padding:.15em .35em;border-radius:5px}
pre{background:var(--mdprv-code-bg);border:1px solid var(--mdprv-border);border-radius:6px;padding:1em;overflow:auto}
pre code{background:none;padding:0;font-size:.85em}
pre.shiki{background:var(--mdprv-code-bg)}
pre:not(.mermaid),pre:not(.mermaid) code,pre.shiki,pre.shiki code{line-height:var(--mdprv-code-line-height)}
blockquote{margin:0 0 1em;padding:0 1em;color:var(--mdprv-quote);border-left:.25em solid var(--mdprv-border)}
ul,ol{margin:0 0 1em;padding-left:2em}
li{margin:.25em 0}
li input[type=checkbox]{margin-right:.4em}
table{border-collapse:collapse;margin:0 0 1em;display:block;overflow:auto}
th,td{border:1px solid var(--mdprv-border);padding:.4em .75em}
th{background:var(--mdprv-code-bg);font-weight:600}
img{max-width:100%}
hr{height:1px;border:0;background:var(--mdprv-border);margin:2em 0}
del{color:var(--mdprv-muted)}
sup{font-size:.75em}
pre.mermaid{position:relative;background:transparent;border:0;text-align:center;overflow:visible}
pre.mermaid svg{max-width:100%;height:auto}
.mdprv-mermaid-fs{position:absolute;top:.4rem;right:.4rem;z-index:5;display:inline-flex;align-items:center;justify-content:center;width:1.9rem;height:1.9rem;padding:0;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;opacity:0;transition:opacity .15s,color .15s,background .15s}
pre.mermaid:hover .mdprv-mermaid-fs,.mdprv-mermaid-fs:focus-visible{opacity:1}
.mdprv-mermaid-fs:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg)}
.mdprv-mermaid-fs svg{width:1rem;height:1rem;display:block}
.mdprv-mermaid-lightbox{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--mdprv-bg) 92%,#000);-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease,visibility .15s ease}
.mdprv-mermaid-lightbox.mdprv-mermaid-open{opacity:1;visibility:visible;pointer-events:auto}
.mdprv-mermaid-stage{width:92vw;height:88vh;display:flex;align-items:center;justify-content:center;overflow:hidden}
.mdprv-mermaid-zoom{transform-origin:center center;cursor:grab}
.mdprv-mermaid-zoom.mdprv-mermaid-pan{cursor:grabbing}
.mdprv-mermaid-tools{position:absolute;bottom:1rem;right:1rem;z-index:2;display:flex;gap:.4rem}
.mdprv-mermaid-tools button{display:inline-flex;align-items:center;justify-content:center;min-width:2.2rem;height:2.2rem;padding:0 .55rem;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;font:inherit;font-size:14px;line-height:1}
.mdprv-mermaid-tools button:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg)}
.mdprv-mermaid-stage svg{max-width:100%;max-height:100%;width:auto;height:auto}
.mdprv-mermaid-close{position:absolute;top:1rem;right:1rem;display:inline-flex;align-items:center;justify-content:center;width:2.2rem;height:2.2rem;padding:0;border:1px solid var(--mdprv-border);border-radius:50%;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer}
.mdprv-mermaid-close:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg)}
.mdprv-mermaid-close svg{width:1.1rem;height:1.1rem;display:block}
body.mdprv-mermaid-lock{overflow:hidden}
.mdprv-sidebar{position:fixed;top:0;left:0;height:100vh;width:var(--mdprv-sidebar-width);overflow:auto;padding:3rem .9rem 1rem;border-right:1px solid var(--mdprv-border);background:var(--mdprv-bg);z-index:30;transition:width var(--mdprv-ui-dur) ease,padding var(--mdprv-ui-dur) ease,opacity var(--mdprv-ui-dur) ease}
html.mdprv-left-collapsed .mdprv-sidebar{width:0;padding:0;border-right-color:transparent;opacity:0;overflow:hidden;pointer-events:none}
.mdprv-theme{display:block;width:100%;font:inherit;font-size:13px;padding:.3rem .5rem;color:var(--mdprv-fg);background:var(--mdprv-code-bg);border:1px solid var(--mdprv-border);border-radius:6px;cursor:pointer}
.mdprv-toc{margin-top:1rem;font-size:13.5px}
.mdprv-toc ul{list-style:none;margin:0;padding:0}
.mdprv-toc li{margin:.1rem 0}
.mdprv-toc a{display:block;padding:.2rem .35rem;border-radius:5px;color:var(--mdprv-muted);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdprv-toc a:hover{background:var(--mdprv-code-bg);color:var(--mdprv-fg)}
.mdprv-toc a.active{color:var(--mdprv-link);background:var(--mdprv-code-bg);font-weight:600}
.mdprv-drag{position:fixed;top:0;bottom:0;width:8px;z-index:40;cursor:col-resize;touch-action:none}
.mdprv-drag::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;transform:translateX(-50%);background:var(--mdprv-border);transition:background .15s,width .15s}
.mdprv-drag:hover::before,.mdprv-drag.mdprv-dragging::before{background:var(--mdprv-link);width:2px}
.mdprv-drag-left{left:calc(50% - var(--mdprv-content-width) / 2)}
.mdprv-drag-right{right:calc(50% - var(--mdprv-content-width) / 2)}
.mdprv-meta-card{margin:0 0 1.5rem;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-code-bg);font-size:.85em;color:var(--mdprv-muted);overflow:hidden}
.mdprv-meta-card>summary{cursor:pointer;padding:.55rem .8rem;list-style:none;color:var(--mdprv-fg);font-weight:600}
.mdprv-meta-card>summary::-webkit-details-marker{display:none}
.mdprv-meta-card>summary::before{content:"\\25B8";display:inline-block;margin-right:.5rem;color:var(--mdprv-muted);transition:transform .15s}
.mdprv-meta-card[open]>summary::before{transform:rotate(90deg)}
.mdprv-meta-card dl{margin:0;padding:0 .8rem .7rem;display:grid;grid-template-columns:auto 1fr;gap:.4rem .8rem}
.mdprv-meta-card dt{font-weight:600;color:var(--mdprv-fg);text-transform:uppercase;font-size:.8em;letter-spacing:.03em;align-self:center}
.mdprv-meta-card dd{margin:0;display:flex;flex-wrap:wrap;gap:.35rem;align-items:center}
.mdprv-tag{display:inline-block;padding:.05rem .5rem;border:1px solid var(--mdprv-border);border-radius:999px;background:var(--mdprv-bg)}
.mdprv-code{position:relative}
.mdprv-copy{position:absolute;top:.4rem;right:.4rem;display:inline-flex;align-items:center;justify-content:center;width:1.9rem;height:1.9rem;padding:0;border:1px solid var(--mdprv-border);border-radius:5px;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;opacity:0;transition:opacity .15s,color .15s,background .15s}
.mdprv-code:hover .mdprv-copy,.mdprv-copy:focus-visible{opacity:1}
.mdprv-copy:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg)}
.mdprv-copy.mdprv-copied{color:var(--mdprv-link);opacity:1}
.mdprv-copy svg{width:1rem;height:1rem;display:block}
.mdprv-top{position:fixed;right:1rem;bottom:4.4rem;z-index:45;display:inline-flex;align-items:center;justify-content:center;width:2.4rem;height:2.4rem;padding:0;border:1px solid var(--mdprv-border);border-radius:50%;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;opacity:0;visibility:hidden;transition:opacity .2s,visibility .2s,color .15s,background .15s}
.mdprv-top.mdprv-top-visible{opacity:.85;visibility:visible}
.mdprv-top:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg);opacity:1}
.mdprv-top svg{width:1.1rem;height:1.1rem;display:block}
.mdprv-zen-toggle{position:fixed;right:1rem;bottom:1.5rem;z-index:45;display:inline-flex;align-items:center;justify-content:center;width:2.4rem;height:2.4rem;padding:0;border:1px solid var(--mdprv-border);border-radius:50%;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;opacity:.85;transition:color .15s,background .15s,opacity .15s}
.mdprv-zen-toggle:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg);opacity:1}
.mdprv-zen-toggle svg{width:1.1rem;height:1.1rem;display:block}
html:not(.mdprv-zen) .mdprv-zen-toggle .mdprv-icon-exit{display:none}
html.mdprv-zen .mdprv-zen-toggle .mdprv-icon-enter{display:none}
.mdprv-sidebar-head{display:flex;align-items:center;gap:.5rem;margin-bottom:.45rem}
.mdprv-sidebar-title{font-size:11.5px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--mdprv-muted)}
.mdprv-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:1.9rem;height:1.9rem;padding:0;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-code-bg);color:var(--mdprv-muted);cursor:pointer;transition:color .15s,background .15s,transform var(--mdprv-ui-dur) ease}
.mdprv-iconbtn:hover{color:var(--mdprv-fg)}
.mdprv-iconbtn svg{width:1.05rem;height:1.05rem;display:block}
.mdprv-settings{position:fixed;bottom:3rem;left:.6rem;width:calc(var(--mdprv-sidebar-width) - 1.2rem);max-height:70vh;overflow:auto;z-index:60;padding:.6rem;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-bg);box-shadow:0 8px 28px rgba(0,0,0,.28)}
.mdprv-settings[hidden]{display:none}
.mdprv-field-label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mdprv-muted);margin:.55rem 0 .3rem}
.mdprv-field-label:first-child{margin-top:0}
.mdprv-input{display:block;width:100%;font:inherit;font-size:13px;padding:.3rem .5rem;color:var(--mdprv-fg);background:var(--mdprv-bg);border:1px solid var(--mdprv-border);border-radius:6px}
.mdprv-font-row{display:flex;flex-direction:column;gap:.35rem}
.mdprv-font-actions{display:flex;gap:.35rem}
.mdprv-btn{flex:1;font:inherit;font-size:12px;padding:.3rem .45rem;color:var(--mdprv-fg);background:var(--mdprv-bg);border:1px solid var(--mdprv-border);border-radius:6px;cursor:pointer}
.mdprv-btn:hover{background:var(--mdprv-code-bg)}
.mdprv-sidebar-toggle,.mdprv-history-toggle,.mdprv-settings-toggle{position:fixed;z-index:50;display:inline-flex;align-items:center;justify-content:center;width:2rem;height:2rem;padding:0;border:1px solid var(--mdprv-border);border-radius:6px;background:var(--mdprv-bg);color:var(--mdprv-muted);cursor:pointer;transition:opacity var(--mdprv-ui-dur) ease,visibility var(--mdprv-ui-dur) ease,color .15s,background .15s}
.mdprv-sidebar-toggle{top:.6rem;left:.6rem}
.mdprv-history-toggle{top:.6rem;right:.6rem}
.mdprv-settings-toggle{bottom:.6rem;left:.6rem}
.mdprv-sidebar-toggle:hover,.mdprv-history-toggle:hover,.mdprv-settings-toggle:hover{color:var(--mdprv-fg);background:var(--mdprv-code-bg)}
.mdprv-sidebar-toggle svg,.mdprv-history-toggle svg,.mdprv-settings-toggle svg{width:1.1rem;height:1.1rem;display:block}
.mdprv-history{position:fixed;top:0;right:0;height:100vh;width:var(--mdprv-sidebar-width);overflow:auto;padding:3rem .9rem 1rem;border-left:1px solid var(--mdprv-border);background:var(--mdprv-bg);z-index:30;transition:width var(--mdprv-ui-dur) ease,padding var(--mdprv-ui-dur) ease,opacity var(--mdprv-ui-dur) ease}
html.mdprv-right-collapsed .mdprv-history{width:0;padding:0;border-left-color:transparent;opacity:0;overflow:hidden;pointer-events:none}
.mdprv-history-list{list-style:none;margin:0;padding:0;font-size:13.5px}
.mdprv-history-list li{margin:.1rem 0}
.mdprv-history-list a{display:block;padding:.25rem .35rem;border-radius:5px;color:var(--mdprv-muted);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mdprv-history-list a:hover{background:var(--mdprv-code-bg);color:var(--mdprv-fg)}
.mdprv-history-list a.active{color:var(--mdprv-link);background:var(--mdprv-code-bg);font-weight:600}
html.mdprv-zen .mdprv-sidebar,html.mdprv-zen .mdprv-history{width:0;padding:0;border-color:transparent;opacity:0;overflow:hidden;pointer-events:none}
html.mdprv-zen .mdprv-sidebar-toggle,html.mdprv-zen .mdprv-history-toggle,html.mdprv-zen .mdprv-settings-toggle{opacity:0;visibility:hidden;pointer-events:none}
html.mdprv-zen .mdprv-settings{display:none}
html.mdprv-zen .mdprv-drag{opacity:0;visibility:hidden;pointer-events:none}
.mdprv-loader-overlay{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--mdprv-bg) 55%,transparent);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .15s ease,visibility .15s ease}
.mdprv-loader-overlay.mdprv-loader-active{opacity:1;visibility:visible;pointer-events:auto}
.mdprv-loader{position:relative;width:2rem;height:2rem;color:var(--mdprv-link)}
.mdprv-loader--classic{width:2rem;height:2rem;border:.2rem solid var(--mdprv-border);border-top-color:var(--mdprv-link);border-radius:50%;animation:mdprv-spin .8s linear infinite}
.mdprv-loader--dots{width:.55rem;height:.55rem;border-radius:50%;background:var(--mdprv-link);animation:mdprv-dots 1s ease-in-out infinite}
.mdprv-loader--dots::before,.mdprv-loader--dots::after{content:"";position:absolute;top:0;width:.55rem;height:.55rem;border-radius:50%;background:var(--mdprv-link);animation:mdprv-dots 1s ease-in-out infinite}
.mdprv-loader--dots::before{left:-.95rem;animation-delay:-.16s}
.mdprv-loader--dots::after{left:.95rem;animation-delay:.16s}
.mdprv-loader--bars{width:.28rem;height:1.4rem;border-radius:2px;background:var(--mdprv-link);animation:mdprv-bars 1s ease-in-out infinite}
.mdprv-loader--bars::before,.mdprv-loader--bars::after{content:"";position:absolute;top:50%;width:.28rem;height:1.4rem;border-radius:2px;background:var(--mdprv-link);transform:translateY(-50%);animation:mdprv-bars 1s ease-in-out infinite}
.mdprv-loader--bars::before{left:-.5rem;animation-delay:-.2s}
.mdprv-loader--bars::after{left:.5rem;animation-delay:.2s}
.mdprv-loader--ring{width:2rem;height:2rem;border:.18rem solid var(--mdprv-link);border-radius:50%;animation:mdprv-ring 1.2s ease-out infinite}
.mdprv-loader--ring::after{content:"";position:absolute;inset:-.18rem;border:.18rem solid var(--mdprv-link);border-radius:50%;animation:mdprv-ring 1.2s ease-out infinite;animation-delay:-.6s}
.mdprv-loader--pulse{width:2rem;height:2rem;border-radius:50%;background:var(--mdprv-link);animation:mdprv-pulse 1s ease-out infinite}
.mdprv-loader--braille{width:2rem;height:2rem;display:flex;align-items:center;justify-content:center;font-size:2rem;line-height:1;color:var(--mdprv-link)}
.mdprv-loader--braille::before{content:"⠋";font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;animation:mdprv-braille 1s steps(1,end) infinite}
@keyframes mdprv-spin{to{transform:rotate(360deg)}}
@keyframes mdprv-dots{0%,80%,100%{transform:translateY(0);opacity:.5}40%{transform:translateY(-.6rem);opacity:1}}
@keyframes mdprv-bars{0%,100%{height:.5rem}50%{height:1.6rem}}
@keyframes mdprv-ring{0%{transform:scale(.6);opacity:1}100%{transform:scale(1.35);opacity:0}}
@keyframes mdprv-pulse{0%{transform:scale(0);opacity:1}100%{transform:scale(1);opacity:0}}
@keyframes mdprv-braille{0%{content:"⠋"}9%{content:"⠙"}18%{content:"⠹"}27%{content:"⠸"}36%{content:"⠼"}45%{content:"⠴"}54%{content:"⠦"}63%{content:"⠧"}72%{content:"⠇"}81%{content:"⠏"}90%,100%{content:"⠋"}}`;

const SHIKI_DUAL_CSS = `@media (prefers-color-scheme: dark){.shiki,.shiki span{color:var(--shiki-dark)!important;background-color:var(--shiki-dark-bg)!important}}`;

function scriptSafe(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildScripts(theme: ThemeDef, loaderName: string): string {
  const data = {
    auto: theme.kind === "auto",
    mermaid: theme.mermaid,
    mermaidDark: theme.mermaidDark || null,
  };
  return `(function(){
  var root = document.documentElement;
  var MIN = 28 * 16;
  var width = null;
  function maxWidth(){ return Math.max(MIN, window.innerWidth - 48); }
  function clamp(px){
    if (!isFinite(px)) return MIN;
    if (px < MIN) return MIN;
    var max = maxWidth();
    if (px > max) return max;
    return px;
  }
  function apply(px){
    width = clamp(px);
    root.style.setProperty("--mdprv-content-width", width + "px");
  }
  function store(px){
    var v = String(Math.round(clamp(px)));
    try { localStorage.setItem("mdprv_width", v); } catch (e) {}
    document.cookie = "mdprv_width=" + encodeURIComponent(v) + ";path=/;max-age=31536000;SameSite=Lax";
  }
  function readStored(){
    var raw = null;
    try { raw = localStorage.getItem("mdprv_width"); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(/(?:^|;\\s*)mdprv_width=([^;]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    if (raw === null || raw === "") return null;
    var n = parseInt(raw, 10);
    return isFinite(n) ? n : null;
  }
  var stored = readStored();
  if (stored !== null) apply(stored);
  window.addEventListener("resize", function(){ if (width !== null) apply(width); });
  var handles = [
    document.getElementById("mdprv-drag-left"),
    document.getElementById("mdprv-drag-right")
  ].filter(Boolean);
  function move(e){
    apply(2 * Math.abs(e.clientX - window.innerWidth / 2));
  }
  function stop(){
    handles.forEach(function(h){ h.classList.remove("mdprv-dragging"); });
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    if (width !== null) store(width);
  }
  handles.forEach(function(h){
    h.addEventListener("pointerdown", function(e){
      e.preventDefault();
      try { h.setPointerCapture(e.pointerId); } catch (err) {}
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      handles.forEach(function(x){ x.classList.add("mdprv-dragging"); });
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    });
  });
})();
(function(){
  var data = ${scriptSafe(data)};
  function cfg(){
    if (data.auto) {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? data.mermaidDark : data.mermaid;
    }
    return data.mermaid;
  }
  function decorate(){
    var pres = document.querySelectorAll("article pre.mermaid");
    Array.prototype.forEach.call(pres, function(pre){
      if (!pre.querySelector("svg")) return;
      if (pre.querySelector(".mdprv-mermaid-fs")) return;
      var b = document.createElement("button");
      b.type = "button";
      b.className = "mdprv-mermaid-fs";
      b.setAttribute("aria-label", "View diagram full screen");
      b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
      b.addEventListener("click", function(){ openLightbox(pre.querySelector("svg")); });
      pre.appendChild(b);
    });
  }
  var zoomEl = null;
  var z = 1;
  var tx = 0;
  var ty = 0;
  function applyZoom(){
    if (zoomEl) zoomEl.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + z + ")";
    if (resetBtn) resetBtn.textContent = Math.round(z * 100) + "%";
  }
  function setZoom(nz){
    z = Math.max(0.25, Math.min(8, nz));
    applyZoom();
  }
  function sensitivity(){
    var raw = null;
    try { raw = localStorage.getItem("mdprv_zoom_sensitivity"); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(/(?:^|;\\s*)mdprv_zoom_sensitivity=([^;]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    var v = raw !== null && raw !== "" ? parseFloat(raw) : NaN;
    if (!isFinite(v)) v = parseFloat(document.documentElement.getAttribute("data-zoom-sensitivity")) || 1.1;
    if (!isFinite(v) || v <= 1) v = 1.1;
    if (v > 3) v = 3;
    return v;
  }
  function openLightbox(svg){
    var lb = document.getElementById("mdprv-mermaid-lightbox");
    var stage = document.getElementById("mdprv-mermaid-stage");
    if (!lb || !stage || !svg) return;
    stage.innerHTML = "";
    zoomEl = document.createElement("div");
    zoomEl.className = "mdprv-mermaid-zoom";
    var clone = svg.cloneNode(true);
    var rect = svg.getBoundingClientRect();
    var w = rect.width || parseFloat(svg.getAttribute("width")) || 300;
    var h = rect.height || parseFloat(svg.getAttribute("height")) || 150;
    var fit = Math.min(stage.clientWidth / w, stage.clientHeight / h);
    if (!isFinite(fit) || fit <= 0) fit = 1;
    if (fit > 4) fit = 4;
    clone.removeAttribute("width");
    clone.removeAttribute("height");
    clone.style.maxWidth = "none";
    clone.style.maxHeight = "none";
    clone.style.width = (w * fit) + "px";
    clone.style.height = (h * fit) + "px";
    zoomEl.appendChild(clone);
    stage.appendChild(zoomEl);
    z = 1;
    tx = 0;
    ty = 0;
    applyZoom();
    lb.classList.add("mdprv-mermaid-open");
    lb.setAttribute("aria-hidden", "false");
    document.body.classList.add("mdprv-mermaid-lock");
  }
  function closeLightbox(){
    var lb = document.getElementById("mdprv-mermaid-lightbox");
    var stage = document.getElementById("mdprv-mermaid-stage");
    if (!lb) return;
    lb.classList.remove("mdprv-mermaid-open");
    lb.setAttribute("aria-hidden", "true");
    document.body.classList.remove("mdprv-mermaid-lock");
    if (stage) stage.innerHTML = "";
    zoomEl = null;
  }
  var lbEl = document.getElementById("mdprv-mermaid-lightbox");
  var resetBtn = lbEl ? lbEl.querySelector(".mdprv-mermaid-reset") : null;
  var inBtn = lbEl ? lbEl.querySelector(".mdprv-mermaid-in") : null;
  var outBtn = lbEl ? lbEl.querySelector(".mdprv-mermaid-out") : null;
  if (lbEl) lbEl.addEventListener("click", function(e){ if (e.target === lbEl) closeLightbox(); });
  var lbClose = document.querySelector(".mdprv-mermaid-close");
  if (lbClose) lbClose.addEventListener("click", closeLightbox);
  if (inBtn) inBtn.addEventListener("click", function(){ setZoom(z * 1.25); });
  if (outBtn) outBtn.addEventListener("click", function(){ setZoom(z / 1.25); });
  if (resetBtn) resetBtn.addEventListener("click", function(){ z = 1; tx = 0; ty = 0; applyZoom(); });
  if (lbEl) lbEl.addEventListener("wheel", function(e){
    if (!lbEl.classList.contains("mdprv-mermaid-open")) return;
    e.preventDefault();
    var s = sensitivity();
    setZoom(e.deltaY < 0 ? z * s : z / s);
  }, { passive: false });
  var stageEl = document.getElementById("mdprv-mermaid-stage");
  if (stageEl) {
    var dragging = false;
    var startX = 0;
    var startY = 0;
    stageEl.addEventListener("pointerdown", function(e){
      if (!zoomEl) return;
      dragging = true;
      startX = e.clientX - tx;
      startY = e.clientY - ty;
      zoomEl.classList.add("mdprv-mermaid-pan");
      try { stageEl.setPointerCapture(e.pointerId); } catch (err) {}
    });
    stageEl.addEventListener("pointermove", function(e){
      if (!dragging) return;
      tx = e.clientX - startX;
      ty = e.clientY - startY;
      applyZoom();
    });
    stageEl.addEventListener("pointerup", function(){
      dragging = false;
      if (zoomEl) zoomEl.classList.remove("mdprv-mermaid-pan");
    });
  }
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeLightbox(); });
  if (typeof mermaid !== "undefined") {
    try {
      mermaid.initialize(Object.assign({ startOnLoad: false, securityLevel: "strict" }, cfg()));
      var pr = mermaid.run({ querySelector: "pre.mermaid" });
      if (pr && pr.then) { pr.then(decorate, decorate); } else { decorate(); }
    } catch (e) { console.error("md-preview: mermaid", e); decorate(); }
  }
})();
(function(){
  var root = document.documentElement;
  var LOADERS = ${scriptSafe(LOADERS)};
  var DEFAULT = ${scriptSafe(loaderName)};
  var overlay = document.getElementById("mdprv-loader-overlay");
  var spinner = document.getElementById("mdprv-loader-spinner");
  var select = document.getElementById("mdprv-loader");
  var current = DEFAULT;
  function isLoader(v){ return typeof v === "string" && LOADERS.indexOf(v) >= 0; }
  function readLoader(){
    var raw = null;
    try { raw = localStorage.getItem("mdprv_loader"); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(/(?:^|;\\s*)mdprv_loader=([^;]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    return isLoader(raw) ? raw : DEFAULT;
  }
  function applyLoader(name){
    if (!isLoader(name)) name = DEFAULT;
    current = name;
    if (spinner) spinner.className = "mdprv-loader mdprv-loader--" + name;
    if (select && select.value !== name) select.value = name;
    root.setAttribute("data-loader", name);
  }
  function store(name){
    try { localStorage.setItem("mdprv_loader", name); } catch (e) {}
    document.cookie = "mdprv_loader=" + encodeURIComponent(name) + ";path=/;max-age=31536000;SameSite=Lax";
  }
  function showLoader(){ if (overlay) overlay.classList.add("mdprv-loader-active"); }
  function hideLoader(){ if (overlay) overlay.classList.remove("mdprv-loader-active"); }
  function flash(ms){ showLoader(); setTimeout(hideLoader, ms); }
  function settle(){
    showLoader();
    var start = Date.now();
    var MIN = 180;
    var finished = false;
    function finish(){
      if (finished) return;
      finished = true;
      var wait = Math.max(0, MIN - (Date.now() - start));
      setTimeout(function(){
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(hideLoader);
        else hideLoader();
      }, wait);
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(finish, finish);
      setTimeout(finish, 600);
    } else {
      setTimeout(finish, 250);
    }
  }
  applyLoader(readLoader());
  window.mdprvLoader = { show: showLoader, hide: hideLoader, set: applyLoader, store: store, flash: flash, settle: settle, current: function(){ return current; } };
  var pending = false;
  try {
    pending = sessionStorage.getItem("mdprv_loader_pending") === "1";
    if (pending) sessionStorage.removeItem("mdprv_loader_pending");
  } catch (e) {}
  if (pending) {
    showLoader();
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle);
  }
  if (select) {
    select.addEventListener("change", function(){
      applyLoader(select.value);
      store(current);
      flash(400);
    });
  }
})();
(function(){
  var sel = document.getElementById("mdprv-theme");
  if (!sel) return;
  sel.addEventListener("change", function(){
    var v = sel.value;
    if (window.mdprvLoader) {
      window.mdprvLoader.show();
      try { sessionStorage.setItem("mdprv_loader_pending", "1"); } catch (e) {}
    }
    document.cookie = "mdprv_theme=" + encodeURIComponent(v) + ";path=/;max-age=31536000;SameSite=Lax";
    setTimeout(function(){
      location.href = location.pathname + (v === "auto" ? "" : "?theme=" + encodeURIComponent(v));
    }, 80);
  });
})();
(function(){
  function buildToc(){
    var article = document.querySelector("article.markdown-body");
    var nav = document.getElementById("mdprv-toc");
    if (!article || !nav) return;
    var heads = Array.prototype.slice.call(
      article.querySelectorAll("h1[id],h2[id],h3[id],h4[id],h5[id],h6[id]")
    );
    if (heads.length === 0) {
      nav.style.display = "none";
      return;
    }
    var minLevel = 6;
    heads.forEach(function(h){ minLevel = Math.min(minLevel, parseInt(h.tagName.charAt(1), 10)); });
    var ul = document.createElement("ul");
    var links = {};
    heads.forEach(function(h){
      var level = parseInt(h.tagName.charAt(1), 10);
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = "#" + h.id;
      a.textContent = h.textContent;
      a.style.paddingLeft = ((level - minLevel) * 12) + "px";
      a.addEventListener("click", function(ev){
        ev.preventDefault();
        if (h.scrollIntoView) h.scrollIntoView({ behavior: "smooth", block: "start" });
        if (window.history && history.replaceState) history.replaceState(null, "", "#" + h.id);
      });
      links[h.id] = a;
      li.appendChild(a);
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    if (typeof IntersectionObserver !== "undefined") {
      try {
        var obs = new IntersectionObserver(function(entries){
          entries.forEach(function(en){
            if (en.isIntersecting) {
              Object.keys(links).forEach(function(k){ links[k].classList.remove("active"); });
              if (links[en.target.id]) links[en.target.id].classList.add("active");
            }
          });
        }, { rootMargin: "0px 0px -75% 0px", threshold: 0 });
        heads.forEach(function(h){ obs.observe(h); });
      } catch (e) {}
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildToc);
  } else {
    buildToc();
  }
})();
(function(){
  var current = null;
  var base = location.pathname.replace(/\\/$/, "");
  function poll(){
    fetch(base + "/version" + location.search)
      .then(function(r){ return r.text(); })
      .then(function(v){
        if (current === null) { current = v; }
        else if (v !== current) { current = v; location.reload(); }
      })
      .catch(function(){});
  }
  setInterval(poll, 700);
})();
(function(){
  var COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>';
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>';
  function fallback(text, done){
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) done();
    } catch (e) {}
  }
  function copyText(text, done){
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function(){ fallback(text, done); });
        return;
      }
    } catch (e) {}
    fallback(text, done);
  }
  function setup(pre){
    if (!pre || !pre.parentNode) return;
    if (pre.parentNode.classList && pre.parentNode.classList.contains("mdprv-code")) return;
    var box = document.createElement("div");
    box.className = "mdprv-code";
    pre.parentNode.insertBefore(box, pre);
    box.appendChild(pre);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mdprv-copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.innerHTML = COPY;
    btn.addEventListener("click", function(){
      var text = pre.innerText;
      copyText(text, function(){
        btn.innerHTML = CHECK;
        btn.classList.add("mdprv-copied");
        clearTimeout(btn._mdprvTimer);
        btn._mdprvTimer = setTimeout(function(){
          btn.innerHTML = COPY;
          btn.classList.remove("mdprv-copied");
        }, 1200);
      });
    });
    box.appendChild(btn);
  }
  function init(){
    var article = document.querySelector("article.markdown-body");
    if (!article) return;
    var pres = article.querySelectorAll("pre:not(.mermaid)");
    Array.prototype.forEach.call(pres, setup);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
(function(){
  var btn = document.getElementById("mdprv-top");
  if (!btn) return;
  var ticking = false;
  function update(){
    ticking = false;
    if (window.scrollY > 300) btn.classList.add("mdprv-top-visible");
    else btn.classList.remove("mdprv-top-visible");
  }
  window.addEventListener("scroll", function(){
    if (ticking) return;
    ticking = true;
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
    else setTimeout(update, 100);
  }, { passive: true });
  update();
  btn.addEventListener("click", function(){
    try { window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e) { window.scrollTo(0, 0); }
  });
})();
(function(){
  var root = document.documentElement;
  function readRaw(key, re){
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(re);
      if (m) raw = decodeURIComponent(m[1]);
    }
    return raw;
  }
  function persist(key, value){
    try { localStorage.setItem(key, value); } catch (e) {}
    document.cookie = key + "=" + encodeURIComponent(value) + ";path=/;max-age=31536000;SameSite=Lax";
  }
  function wire(classKey, buttonId, re){
    var btn = document.getElementById(buttonId);
    var raw = readRaw(classKey, re);
    if (raw === "1" || raw === "true") root.classList.add(classKey);
    function sync(){
      var collapsed = root.classList.contains(classKey);
      if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    sync();
    if (btn) {
      btn.addEventListener("click", function(){
        root.classList.toggle(classKey);
        persist(classKey, root.classList.contains(classKey) ? "1" : "0");
        sync();
      });
    }
  }
  wire("mdprv-left-collapsed", "mdprv-sidebar-toggle", /(?:^|;\\s*)mdprv-left-collapsed=([^;]+)/);
  wire("mdprv-right-collapsed", "mdprv-history-toggle", /(?:^|;\\s*)mdprv-right-collapsed=([^;]+)/);
})();
(function(){
  var btn = document.getElementById("mdprv-settings-toggle");
  var panel = document.getElementById("mdprv-settings");
  if (!btn || !panel) return;
  function sync(){
    btn.setAttribute("aria-expanded", panel.hasAttribute("hidden") ? "false" : "true");
  }
  btn.addEventListener("click", function(){
    if (panel.hasAttribute("hidden")) panel.removeAttribute("hidden");
    else panel.setAttribute("hidden", "");
    sync();
  });
  sync();
})();
(function(){
  var root = document.documentElement;
  var input = document.getElementById("mdprv-font");
  var list = document.getElementById("mdprv-font-list");
  var loadBtn = document.getElementById("mdprv-font-load");
  var resetBtn = document.getElementById("mdprv-font-reset");
  function readFont(){
    var raw = null;
    try { raw = localStorage.getItem("mdprv_font"); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(/(?:^|;\\s*)mdprv_font=([^;]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    return raw || "";
  }
  function apply(value){
    var v = (value || "").trim();
    if (v) root.style.setProperty("--mdprv-font", v);
    else root.style.removeProperty("--mdprv-font");
  }
  function store(value){
    var v = (value || "").trim();
    try { localStorage.setItem("mdprv_font", v); } catch (e) {}
    document.cookie = "mdprv_font=" + encodeURIComponent(v) + ";path=/;max-age=31536000;SameSite=Lax";
  }
  var initial = readFont();
  if (initial) apply(initial);
  if (input) {
    if (initial) input.value = initial;
    function onChange(){ apply(input.value); store(input.value); }
    input.addEventListener("input", onChange);
    input.addEventListener("change", function(){
      onChange();
      if (window.mdprvLoader) window.mdprvLoader.settle();
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", function(){
      apply("");
      store("");
      if (input) input.value = "";
      if (window.mdprvLoader) window.mdprvLoader.settle();
    });
  }
  if (loadBtn) {
    loadBtn.addEventListener("click", function(){
      if (typeof window.queryLocalFonts !== "function") {
        loadBtn.setAttribute("title", "Local font access is not supported in this browser");
        return;
      }
      window.queryLocalFonts().then(function(fonts){
        if (!list || !fonts) return;
        var seen = {};
        var frag = document.createDocumentFragment();
        Array.prototype.forEach.call(fonts, function(f){
          var name = f && f.family;
          if (!name || seen[name]) return;
          seen[name] = true;
          var opt = document.createElement("option");
          opt.value = name;
          frag.appendChild(opt);
        });
        list.textContent = "";
        list.appendChild(frag);
      }).catch(function(){});
    });
  }
})();
(function(){
  var root = document.documentElement;
  function isEditable(el){
    if (!el) return false;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    return false;
  }
  document.addEventListener("keydown", function(e){
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "z" && e.key !== "Z") return;
    if (isEditable(e.target)) return;
    root.classList.toggle("mdprv-zen");
    if (window.__mdprvSyncZen) window.__mdprvSyncZen();
  });
})();
(function(){
  var zroot = document.documentElement;
  var zbtn = document.getElementById("mdprv-zen-toggle");
  function sync(){
    if (!zbtn) return;
    var on = zroot.classList.contains("mdprv-zen");
    zbtn.setAttribute("aria-pressed", on ? "true" : "false");
    zbtn.setAttribute("aria-label", on ? "Exit zen mode" : "Enter zen mode");
  }
  if (zbtn) zbtn.addEventListener("click", function(){ zroot.classList.toggle("mdprv-zen"); sync(); });
  sync();
  window.__mdprvSyncZen = sync;
})();
(function(){
  var input = document.getElementById("mdprv-zoom-sens");
  if (!input) return;
  function current(){
    var raw = null;
    try { raw = localStorage.getItem("mdprv_zoom_sensitivity"); } catch (e) {}
    if (raw === null || raw === "") {
      var m = document.cookie.match(/(?:^|;\s*)mdprv_zoom_sensitivity=([^;]+)/);
      if (m) raw = decodeURIComponent(m[1]);
    }
    var v = raw !== null && raw !== "" ? parseFloat(raw) : NaN;
    if (!isFinite(v)) v = parseFloat(document.documentElement.getAttribute("data-zoom-sensitivity")) || 1.1;
    return v;
  }
  input.value = String(current());
  function commit(){
    var v = parseFloat(input.value);
    if (!isFinite(v) || v <= 1) v = 1.1;
    if (v > 3) v = 3;
    v = Math.round(v * 100) / 100;
    input.value = String(v);
    document.cookie = "mdprv_zoom_sensitivity=" + encodeURIComponent(String(v)) + ";path=/;max-age=31536000;SameSite=Lax";
    try { localStorage.setItem("mdprv_zoom_sensitivity", String(v)); } catch (e) {}
  }
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
})();
(function(){
  var list = document.getElementById("mdprv-history-list");
  if (!list) return;
  var current = "";
  try { current = decodeURIComponent(location.pathname.slice(1)); }
  catch (e) { current = location.pathname.slice(1); }
  function makeItem(item){
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = "/" + encodeURIComponent(item.slug);
    var title = typeof item.title === "string" ? item.title : "";
    var path = typeof item.path === "string" ? item.path : "";
    if (!title) {
      var base = path.split("/").filter(Boolean).pop();
      title = base || item.slug;
    }
    a.textContent = title;
    a.title = path || item.slug;
    if (item.slug === current) a.className = "active";
    li.appendChild(a);
    return li;
  }
  function load(){
    fetch("/__slugs", { headers: { Accept: "application/json" } })
      .then(function(r){
        if (!r.ok) throw new Error("bad status");
        return r.json();
      })
      .then(function(data){
        var slugs = data && data.slugs;
        if (!Array.isArray(slugs)) return;
        var frag = document.createDocumentFragment();
        slugs.forEach(function(item){
          if (item && typeof item.slug === "string" && item.slug) frag.appendChild(makeItem(item));
        });
        list.textContent = "";
        list.appendChild(frag);
      })
      .catch(function(){});
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
  setInterval(load, 4000);
})();`;
}

export function renderPage(input: PageInput): string {
  const theme = getTheme(input.themeName);
  const loader = resolveLoaderName(input.loader);
  const zoomSensitivity = resolveZoomSensitivity(input.zoomSensitivity);
  const css = [
    themeCss(theme),
    BASE_CSS,
    theme.kind === "auto" ? SHIKI_DUAL_CSS : "",
  ]
    .filter(Boolean)
    .join("\n");

  const options = themeNames()
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}"${name === theme.name ? " selected" : ""}>${escapeHtml(name)}</option>`
    )
    .join("");

  const loaderOptions = LOADERS.map(
    (name) =>
      `<option value="${escapeHtml(name)}"${name === loader ? " selected" : ""}>${escapeHtml(name)}</option>`
  ).join("");

  return [
    "<!DOCTYPE html>",
    `<html lang="en" data-loader="${escapeHtml(loader)}" data-zoom-sensitivity="${zoomSensitivity}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<link rel="icon" href="data:,">',
    `<title>${escapeHtml(input.title)}</title>`,
    "<style>",
    css,
    "</style>",
    "</head>",
    "<body>",
    '<aside class="mdprv-sidebar" id="mdprv-sidebar">',
    '<div class="mdprv-sidebar-head">',
    '<span class="mdprv-sidebar-title">Preview</span>',
    "</div>",
    '<nav id="mdprv-toc" class="mdprv-toc" aria-label="Table of contents"></nav>',
    "</aside>",
    '<button type="button" id="mdprv-settings-toggle" class="mdprv-settings-toggle" aria-label="Preview settings" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg></button>',
    '<div class="mdprv-settings" id="mdprv-settings" hidden>',
    '<label class="mdprv-field-label" for="mdprv-theme">Theme</label>',
    `<select id="mdprv-theme" class="mdprv-theme" aria-label="Theme">${options}</select>`,
    '<label class="mdprv-field-label" for="mdprv-font">Font</label>',
    '<div class="mdprv-font-row">',
    '<input id="mdprv-font" class="mdprv-input" type="text" list="mdprv-font-list" placeholder="Font family (e.g. Inter)" autocomplete="off" spellcheck="false" aria-label="Font family">',
    '<datalist id="mdprv-font-list"></datalist>',
    '<div class="mdprv-font-actions">',
    '<button type="button" id="mdprv-font-load" class="mdprv-btn">Load system fonts</button>',
    '<button type="button" id="mdprv-font-reset" class="mdprv-btn">Reset</button>',
    "</div>",
    "</div>",
    '<label class="mdprv-field-label" for="mdprv-loader">Loader</label>',
    `<select id="mdprv-loader" class="mdprv-theme" aria-label="Loading indicator">${loaderOptions}</select>`,
    '<label class="mdprv-field-label" for="mdprv-zoom-sens">Zoom sensitivity (scroll)</label>',
    `<input id="mdprv-zoom-sens" class="mdprv-input" type="number" min="1.01" max="3" step="0.05" value="${zoomSensitivity}" inputmode="decimal" aria-label="Mermaid zoom scroll sensitivity">`,
    "</div>",
    '<button type="button" id="mdprv-sidebar-toggle" class="mdprv-sidebar-toggle" aria-label="Toggle sidebar" aria-expanded="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M9 3v18"></path></svg></button>',
    '<aside class="mdprv-history" id="mdprv-history" aria-label="Recent previews">',
    '<div class="mdprv-sidebar-head"><span class="mdprv-sidebar-title">Recent</span></div>',
    '<ul class="mdprv-history-list" id="mdprv-history-list"></ul>',
    "</aside>",
    '<button type="button" id="mdprv-history-toggle" class="mdprv-history-toggle" aria-label="Toggle recent previews" aria-expanded="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M15 3v18"></path></svg></button>',
    '<div class="mdprv-drag mdprv-drag-left" id="mdprv-drag-left" role="separator" aria-orientation="vertical" aria-label="Resize content width (left)"></div>',
    '<div class="mdprv-drag mdprv-drag-right" id="mdprv-drag-right" role="separator" aria-orientation="vertical" aria-label="Resize content width (right)"></div>',
    '<button type="button" id="mdprv-top" class="mdprv-top" aria-label="Back to top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg></button>',
    '<button type="button" id="mdprv-zen-toggle" class="mdprv-zen-toggle" aria-label="Enter zen mode" aria-pressed="false"><svg class="mdprv-icon-enter" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3"></path><path d="M16 3h3a2 2 0 0 1 2 2v3"></path><path d="M8 21H5a2 2 0 0 1-2-2v-3"></path><path d="M16 21h3a2 2 0 0 0 2-2v-3"></path></svg><svg class="mdprv-icon-exit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3"></path><path d="M21 8h-3a2 2 0 0 1-2-2V3"></path><path d="M3 16h3a2 2 0 0 1 2 2v3"></path><path d="M16 21v-3a2 2 0 0 1 2-2h3"></path></svg></button>',
    `<div id="mdprv-loader-overlay" class="mdprv-loader-overlay" aria-hidden="true"><div id="mdprv-loader-spinner" class="mdprv-loader mdprv-loader--${escapeHtml(loader)}"></div></div>`,
    '<div id="mdprv-mermaid-lightbox" class="mdprv-mermaid-lightbox" aria-hidden="true"><button type="button" class="mdprv-mermaid-close" aria-label="Close full screen (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="M6 6l12 12"></path></svg></button><div class="mdprv-mermaid-tools"><button type="button" class="mdprv-mermaid-out" aria-label="Zoom out">&minus;</button><button type="button" class="mdprv-mermaid-reset" aria-label="Reset zoom">100%</button><button type="button" class="mdprv-mermaid-in" aria-label="Zoom in">+</button></div><div class="mdprv-mermaid-stage" id="mdprv-mermaid-stage"></div></div>',
    '<article class="markdown-body">',
    renderMeta(input.meta),
    input.body,
    "</article>",
    '<script src="/__assets/mermaid.min.js"></script>',
    "<script>",
    buildScripts(theme, loader),
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}
