/**
 * Validation and normalization for imported Mermaid themes.
 *
 * A custom file is a small, self-contained wrapper (`<slug>.mermaid.json`):
 * a base Mermaid theme plus the `themeVariables` map. Values are validated one
 * by one so nothing executable reaches `mermaid.initialize`.
 */
import { createHash } from "node:crypto";

import {
  MERMAID_THEMES,
  THEME_NAME_RE,
  type BuiltinMermaidThemeName,
} from "./constants";

export const MERMAID_FILE_SUFFIX = ".mermaid.json";
export const MAX_MERMAID_THEMES = 100;
export const MAX_MERMAID_VARIABLES = 512;
export const MAX_MERMAID_VALUE_CHARS = 200;

const ROOT_KEYS = new Set(["schemaVersion", "name", "theme", "variables"]);
const KEY_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const UNSAFE_VALUE = /(?:url|var|expression)\s*\(|javascript:|@import|[;{}<>\\\u0000-\u001f\u007f]/i;

export type MermaidThemeErrorCode = "invalid" | "exists" | "too-large" | "too-many";

export class MermaidThemeError extends Error {
  constructor(
    public readonly code: MermaidThemeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "MermaidThemeError";
  }
}

export interface MermaidCustomTheme {
  name: string;
  theme: BuiltinMermaidThemeName;
  variables: Record<string, string>;
  sha: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new MermaidThemeError("invalid", message);
}

export function isBuiltinMermaidTheme(name: string): name is BuiltinMermaidThemeName {
  return (MERMAID_THEMES as readonly string[]).includes(name);
}

export function mermaidLabel(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function mermaidFileName(name: string): string {
  return `${name}${MERMAID_FILE_SUFFIX}`;
}

/** Safe Mermaid variable: colors, lengths, font stacks and bare numbers. */
export function isMermaidVariableValue(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_MERMAID_VALUE_CHARS ||
    value.trim() === ""
  ) {
    return false;
  }
  return !UNSAFE_VALUE.test(value);
}

const BUILTINS = new Set<string>([...MERMAID_THEMES, "auto"]);

/**
 * Validates the wrapper and returns a normalized custom theme.
 * Throws `MermaidThemeError` with `invalid`, `exists`, `too-many` or `too-large`.
 */
export function validateMermaidCustom(
  raw: unknown,
  expectedName?: string
): MermaidCustomTheme {
  if (!isRecord(raw)) {
    invalid("Mermaid theme wrapper must be an object");
  }
  for (const key of Object.keys(raw)) {
    if (!ROOT_KEYS.has(key)) {
      invalid(`unknown wrapper key ${JSON.stringify(key)}`);
    }
  }
  if (raw.schemaVersion !== 1) {
    invalid("schemaVersion must be 1");
  }
  if (typeof raw.name !== "string" || !THEME_NAME_RE.test(raw.name)) {
    invalid("name must match ^[a-z0-9][a-z0-9-]{0,63}$");
  }
  const name = raw.name;
  if (BUILTINS.has(name)) {
    throw new MermaidThemeError("exists", `Mermaid theme name ${name} is reserved`);
  }
  if (expectedName !== undefined && name !== expectedName) {
    invalid(`name must equal the file name (${expectedName})`);
  }
  const base = raw.theme;
  if (base !== undefined) {
    if (typeof base !== "string" || !isBuiltinMermaidTheme(base)) {
      invalid(`theme must be one of: ${MERMAID_THEMES.join(", ")}`);
    }
  }
  if (!isRecord(raw.variables)) {
    invalid("variables must be an object");
  }
  const entries = Object.entries(raw.variables);
  if (entries.length > MAX_MERMAID_VARIABLES) {
    throw new MermaidThemeError(
      "too-many",
      `variables has too many entries (max ${MAX_MERMAID_VARIABLES})`
    );
  }
  const variables: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) {
      invalid(`variables.${key} is not a valid key`);
    }
    if (!isMermaidVariableValue(value)) {
      invalid(`variables.${key} must be a safe string of at most ${MAX_MERMAID_VALUE_CHARS} characters`);
    }
    variables[key] = value;
  }
  const theme = (base as BuiltinMermaidThemeName | undefined) ?? "base";
  const sha = createHash("sha1")
    .update(JSON.stringify({ theme, variables }))
    .digest("hex")
    .slice(0, 8);
  return { name, theme, variables, sha };
}
