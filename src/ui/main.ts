import "./styles/base.css";
import "./styles/meta.css";
import "./styles/sidebar.css";
import "./styles/mermaid.css";
import "./styles/loader.css";

import { initCopyCode } from "./islands/copy-code";
import { initHistory } from "./islands/history";
import { initLayout } from "./islands/layout";
import { initLiveReload } from "./islands/live-reload";
import { initLoaderOverlay } from "./islands/loader-overlay";
import { initMermaidLightbox } from "./islands/mermaid-lightbox";
import { initSettings } from "./islands/settings";
import { initToc } from "./islands/toc";

initLayout();
initLoaderOverlay();
initSettings();
initMermaidLightbox();
initToc();
initLiveReload();
initCopyCode();
initHistory();
