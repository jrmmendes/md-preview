/**
 * Regras puras da grade de amostras de emojis.
 *
 * O modal pede as amostras sob demanda (`GET /__emoji-samples/<pack>`) para
 * não inflar o payload da página. A regra visual espelha o render do servidor:
 * data URI vira `<img>`, estilo não nativo usa o SVG do pacote (`onerror` cai
 * no Unicode) e `native` mostra o próprio glifo.
 */
import { isEmojiStyle } from "../../../../core/emoji/constants";
import type {
  EmojiPackEntry,
  EmojiSample,
  EmojiSamplesPayload,
} from "../../../../core/contract";

export const EMOJI_PREVIEW_LIMIT = 24;

export function emojiSamplesEndpoint(name: string): string {
  return `/__emoji-samples/${encodeURIComponent(name)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSample(value: unknown): value is EmojiSample {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name !== "" &&
    typeof value.value === "string" &&
    value.value !== "" &&
    (value.asset === undefined || typeof value.asset === "boolean")
  );
}

export function parseEmojiSamplesPayload(
  raw: unknown,
  expectedName?: string
): EmojiSamplesPayload | null {
  if (
    !isRecord(raw) ||
    typeof raw.name !== "string" ||
    (expectedName !== undefined && raw.name !== expectedName) ||
    !isEmojiStyle(raw.style) ||
    typeof raw.total !== "number" ||
    !Number.isFinite(raw.total) ||
    raw.total < 0 ||
    !Array.isArray(raw.samples)
  ) {
    return null;
  }
  return {
    name: raw.name,
    style: raw.style,
    total: raw.total,
    samples: raw.samples.filter(isSample).slice(0, EMOJI_PREVIEW_LIMIT),
  };
}

export type EmojiSampleView =
  | { kind: "image"; src: string; fallback: string }
  | { kind: "text"; text: string };

/** Same decision as `emojiHtml` in the server renderer, client-side. */
export function emojiSampleView(
  pack: Pick<EmojiPackEntry, "name" | "style">,
  sample: EmojiSample
): EmojiSampleView {
  if (sample.value.startsWith("data:image/")) {
    return { kind: "image", src: sample.value, fallback: "" };
  }
  if (pack.style !== "native") {
    if (sample.asset === false) {
      // Exact server rule: no asset on disk means the Unicode glyph.
      return { kind: "text", text: sample.value };
    }
    return {
      kind: "image",
      src: `/__emoji-assets/${encodeURIComponent(pack.name)}/${encodeURIComponent(sample.name)}.svg`,
      // Older payloads omit `asset`; a 404 still falls back to Unicode.
      fallback: sample.value,
    };
  }
  return { kind: "text", text: sample.value };
}

export async function loadEmojiSamples(
  name: string,
  fetcher: typeof fetch = fetch
): Promise<EmojiSamplesPayload | null> {
  try {
    const response = await fetcher(emojiSamplesEndpoint(name), {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return parseEmojiSamplesPayload(await response.json(), name);
  } catch {
    return null;
  }
}

/** Only imported packs can be removed; builtins are always available. */
export function isUserEmojiPack(entry: Pick<EmojiPackEntry, "source">): boolean {
  return entry.source === "user";
}

export function emojiSourceLabel(entry: Pick<EmojiPackEntry, "source">): string {
  return entry.source === "builtin" ? "Embutido" : "Usuário";
}

/** Compact line shown under the pack name. */
export function emojiPackMeta(entry: EmojiPackEntry): string {
  const count = entry.count === 1 ? "1 shortcode" : `${entry.count} shortcodes`;
  return `${entry.name} · ${entry.style} · ${count} · ${emojiSourceLabel(entry)}`;
}

/** License and attribution, when the pack declares them. */
export function emojiPackCredit(entry: EmojiPackEntry): string | null {
  const parts: string[] = [];
  if (entry.license) {
    parts.push(entry.license);
  }
  if (entry.attribution) {
    parts.push(entry.attribution);
  }
  return parts.length > 0 ? parts.join(" — ") : null;
}
