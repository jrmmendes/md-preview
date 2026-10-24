import type { SlugsEvent, SnapshotEvent, ThemesEvent, VersionEvent } from "../../core/contract";

export interface EventMap {
  snapshot: SnapshotEvent;
  version: VersionEvent;
  slugs: SlugsEvent;
  themes: ThemesEvent;
  ping: { ts: number };
}

type EventType = keyof EventMap;
type Handler<K extends EventType> = (data: EventMap[K]) => void;

const TYPES: EventType[] = ["snapshot", "version", "slugs", "themes", "ping"];

const handlers: { [K in EventType]: Set<Handler<K>> } = {
  snapshot: new Set(),
  version: new Set(),
  slugs: new Set(),
  themes: new Set(),
  ping: new Set(),
};

let source: EventSource | null = null;

function connect(): void {
  if (source || typeof EventSource === "undefined") {
    return;
  }
  source = new EventSource("/__events");
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
