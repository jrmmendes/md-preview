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

declare const mermaid: MermaidApi;
