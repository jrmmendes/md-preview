/**
 * Loader presets shared by the server (theme contract) and the client.
 *
 * Kept free of theme imports so `core/themes/*` can depend on it without
 * creating a cycle.
 */
export const LOADERS = ["classic", "dots", "bars", "ring", "pulse", "braille"] as const;

export type LoaderName = (typeof LOADERS)[number];

export const DEFAULT_LOADER: LoaderName = "classic";

export function isLoaderName(value: unknown): value is LoaderName {
  return typeof value === "string" && (LOADERS as readonly string[]).includes(value);
}
