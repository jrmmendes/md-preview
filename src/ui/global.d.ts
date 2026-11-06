interface MermaidConfigLike {
  theme?: string;
  themeVariables?: Record<string, string>;
  startOnLoad?: boolean;
  securityLevel?: string;
  htmlLabels?: boolean;
}

interface MermaidApi {
  initialize(config: MermaidConfigLike): void;
  run(options: { querySelector: string }): Promise<void> | undefined;
  render(id: string, text: string): Promise<{ svg: string }> | { svg: string };
}

declare const mermaid: MermaidApi;
