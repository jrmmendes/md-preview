/**
 * Regras puras da grade de ícones do pacote selecionado.
 *
 * A prévia não busca nada no servidor: o conjunto de chaves é fechado
 * (`ICON_KEYS`) e cada célula aponta para `/__icon-assets/<pack>/<key>.svg`.
 * O servidor cai para o embutido `breeze` quando o pacote não declara a chave,
 * então a grade sempre desenha os 42 ícones conhecidos.
 */
import type { IconPackEntry } from "../../../../core/contract";
import { ICON_KEYS, iconAssetUrl, type IconKey } from "../../../../core/icons/constants";

export function iconPreviewKeys(): readonly IconKey[] {
  return ICON_KEYS;
}

/** Per-cell mask source for the selected pack; inherits `currentColor`. */
export function iconPreviewSrc(
  pack: Pick<IconPackEntry, "name">,
  key: IconKey
): string {
  return iconAssetUrl(pack.name, key);
}

/** Only imported packs can be removed; builtins are always available. */
export function isUserIconPack(entry: Pick<IconPackEntry, "source">): boolean {
  return entry.source === "user";
}

/** The reserved builtin pack that resolution always keeps available. */
export function isDefaultIconPack(entry: Pick<IconPackEntry, "default">): boolean {
  return entry.default === true;
}

export function iconSourceLabel(entry: Pick<IconPackEntry, "source">): string {
  return entry.source === "builtin" ? "Embutido" : "Usuário";
}

/** Compact line shown under the pack name. */
export function iconPackMeta(entry: IconPackEntry): string {
  const count = entry.count === 1 ? "1 ícone" : `${entry.count} ícones`;
  return `${entry.name} · ${entry.style} · ${count} · ${iconSourceLabel(entry)}`;
}

/** License and attribution, when the pack declares them. */
export function iconPackCredit(entry: IconPackEntry): string | null {
  const parts: string[] = [];
  if (entry.license) {
    parts.push(entry.license);
  }
  if (entry.attribution) {
    parts.push(entry.attribution);
  }
  return parts.length > 0 ? parts.join(" — ") : null;
}
