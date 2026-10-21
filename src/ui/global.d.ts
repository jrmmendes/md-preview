interface MermaidConfigLike {
  theme?: string;
  themeVariables?: Record<string, string>;
  startOnLoad?: boolean;
  securityLevel?: string;
}

interface MermaidApi {
  initialize(config: MermaidConfigLike): void;
  run(options: { querySelector: string }): Promise<void> | undefined;
}

interface LocalFont {
  family?: string;
}

interface Window {
  queryLocalFonts?: () => Promise<LocalFont[]>;
}

declare const mermaid: MermaidApi;
