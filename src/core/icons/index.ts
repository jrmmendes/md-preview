import type { IconPackEntry } from "../contract";
import { DEFAULT_ICON_PACK } from "./constants";
import { createIconStore, type IconStore } from "./store";

let active: IconStore | null = null;

export function getIconStore(): IconStore {
  if (!active) {
    active = createIconStore({ dir: null, watch: false });
  }
  return active;
}

export function setIconStore(store: IconStore | null): void {
  active = store;
}

export function iconPackNames(): string[] {
  return getIconStore().names();
}

export function hasIconPack(name: string | null | undefined): boolean {
  return getIconStore().has(name);
}

export function iconPackEntries(): IconPackEntry[] {
  return getIconStore()
    .list()
    .map((entry) => {
      const out: IconPackEntry = {
        name: entry.name,
        label: entry.label,
        style: entry.style,
        source: entry.source,
        count: entry.count,
      };
      if (entry.default !== undefined) out.default = entry.default;
      if (entry.description !== undefined) out.description = entry.description;
      if (entry.license !== undefined) out.license = entry.license;
      if (entry.attribution !== undefined) out.attribution = entry.attribution;
      return out;
    });
}

export function iconErrors() {
  return getIconStore().errors();
}

export { DEFAULT_ICON_PACK };
export type { IconStore };
