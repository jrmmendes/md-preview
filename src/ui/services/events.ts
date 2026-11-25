import type {
  ActivateEvent,
  MermaidThemesEvent,
  ShikiThemesEvent,
  SlugsEvent,
  SnapshotEvent,
  ThemesEvent,
  VersionEvent,
} from "../../core/contract";

export interface EventMap {
  snapshot: SnapshotEvent;
  version: VersionEvent;
  slugs: SlugsEvent;
  themes: ThemesEvent;
  "shiki-themes": ShikiThemesEvent;
  "mermaid-themes": MermaidThemesEvent;
  activate: ActivateEvent;
  ping: { ts: number };
}

type EventType = keyof EventMap;
type Handler<K extends EventType> = (data: EventMap[K]) => void;

const TYPES: EventType[] = ["snapshot", "version", "slugs", "themes", "shiki-themes", "mermaid-themes", "activate", "ping"];

const handlers: { [K in EventType]: Set<Handler<K>> } = {
  snapshot: new Set(),
  version: new Set(),
  slugs: new Set(),
  themes: new Set(),
  "shiki-themes": new Set(),
  "mermaid-themes": new Set(),
  activate: new Set(),
  ping: new Set(),
};

let source: EventSource | null = null;

/** Slug of the document currently shown, as the daemon knows it. */
export function currentDocumentSlug(): string {
  let slug = "";
  try {
    slug = window.location.pathname.slice(1);
  } catch {
    return "";
  }
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function connect(): void {
  if (source || typeof EventSource === "undefined") {
    return;
  }
  const doc = currentDocumentSlug();
  const query = doc ? `?doc=${encodeURIComponent(doc)}` : "";
  source = new EventSource(`/__events${query}`);
  for (const type of TYPES) {
    source.addEventListener(type, (event) => {
      const message = event as MessageEvent<string>;
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return;
      }
      const set = handlers[type] as Set<(data: unknown) => void>;
      for (const handler of set) {
        handler(data);
      }
    });
  }
}

export function on<K extends EventType>(type: K, handler: Handler<K>): () => void {
  connect();
  const set = handlers[type] as Set<Handler<K>>;
  set.add(handler);
  return () => {
    set.delete(handler);
  };
}
