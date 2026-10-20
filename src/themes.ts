export interface PageVars {
  bg: string;
  fg: string;
  muted: string;
  link: string;
  border: string;
  codeBg: string;
  blockquote: string;
}

export type MermaidThemeName = "default" | "neutral" | "dark" | "forest" | "base";

export interface MermaidConfig {
  theme: MermaidThemeName;
  themeVariables?: Record<string, string>;
}

export interface ThemeDef {
  name: string;
  kind: "auto" | "light" | "dark";
  light?: PageVars;
  dark?: PageVars;
  vars?: PageVars;
  shiki?: string;
  shikiLight?: string;
  shikiDark?: string;
  mermaid: MermaidConfig;
  mermaidDark?: MermaidConfig;
}

const githubLight: PageVars = {
  bg: "#ffffff",
  fg: "#24292f",
  muted: "#57606a",
  link: "#0969da",
  border: "#d0d7de",
  codeBg: "#f6f8fa",
  blockquote: "#57606a",
};

const githubDark: PageVars = {
  bg: "#0d1117",
  fg: "#c9d1d9",
  muted: "#8b949e",
  link: "#58a6ff",
  border: "#30363d",
  codeBg: "#161b22",
  blockquote: "#8b949e",
};

export const THEMES: ThemeDef[] = [
  {
    name: "auto",
    kind: "auto",
    light: githubLight,
    dark: githubDark,
    shikiLight: "github-light",
    shikiDark: "github-dark",
    mermaid: { theme: "default" },
    mermaidDark: { theme: "dark" },
  },
  {
    name: "github-light",
    kind: "light",
    vars: githubLight,
    shiki: "github-light",
    mermaid: { theme: "default" },
  },
  {
    name: "github-dark",
    kind: "dark",
    vars: githubDark,
    shiki: "github-dark",
    mermaid: { theme: "dark" },
  },
  {
    name: "dracula",
    kind: "dark",
    vars: {
      bg: "#282a36",
      fg: "#f8f8f2",
      muted: "#6272a4",
      link: "#8be9fd",
      border: "#44475a",
      codeBg: "#21222c",
      blockquote: "#6272a4",
    },
    shiki: "dracula",
    mermaid: {
      theme: "base",
      themeVariables: {
        background: "#282a36",
        primaryColor: "#44475a",
        primaryTextColor: "#f8f8f2",
        primaryBorderColor: "#bd93f9",
        lineColor: "#bd93f9",
        secondaryColor: "#6272a4",
        tertiaryColor: "#282a36",
        textColor: "#f8f8f2",
        mainBkg: "#44475a",
        nodeBorder: "#bd93f9",
        clusterBkg: "#21222c",
        clusterBorder: "#44475a",
        titleColor: "#f8f8f2",
        edgeLabelBackground: "#282a36",
      },
    },
  },
  {
    name: "nord",
    kind: "dark",
    vars: {
      bg: "#2e3440",
      fg: "#d8dee9",
      muted: "#7b88a1",
      link: "#88c0d0",
      border: "#4c566a",
      codeBg: "#3b4252",
      blockquote: "#7b88a1",
    },
    shiki: "nord",
    mermaid: {
      theme: "neutral",
      themeVariables: {
        background: "#2e3440",
        primaryColor: "#3b4252",
        primaryTextColor: "#d8dee9",
        primaryBorderColor: "#88c0d0",
        lineColor: "#88c0d0",
        secondaryColor: "#4c566a",
        tertiaryColor: "#2e3440",
        textColor: "#d8dee9",
        mainBkg: "#3b4252",
        nodeBorder: "#88c0d0",
        clusterBkg: "#2e3440",
        clusterBorder: "#4c566a",
        titleColor: "#d8dee9",
      },
    },
  },
  {
    name: "solarized-dark",
    kind: "dark",
    vars: {
      bg: "#002b36",
      fg: "#93a1a1",
      muted: "#586e75",
      link: "#268bd2",
      border: "#073642",
      codeBg: "#073642",
      blockquote: "#586e75",
    },
    shiki: "solarized-dark",
    mermaid: {
      theme: "dark",
      themeVariables: {
        background: "#002b36",
        primaryColor: "#073642",
        primaryTextColor: "#93a1a1",
        primaryBorderColor: "#268bd2",
        lineColor: "#268bd2",
        textColor: "#93a1a1",
        mainBkg: "#073642",
        nodeBorder: "#268bd2",
        clusterBkg: "#002b36",
        clusterBorder: "#073642",
        titleColor: "#93a1a1",
      },
    },
  },
  {
    name: "solarized-light",
    kind: "light",
    vars: {
      bg: "#fdf6e3",
      fg: "#657b83",
      muted: "#93a1a1",
      link: "#268bd2",
      border: "#eee8d5",
      codeBg: "#eee8d5",
      blockquote: "#93a1a1",
    },
    shiki: "solarized-light",
    mermaid: {
      theme: "default",
      themeVariables: {
        background: "#fdf6e3",
        primaryColor: "#eee8d5",
        primaryTextColor: "#657b83",
        primaryBorderColor: "#268bd2",
        lineColor: "#268bd2",
        textColor: "#657b83",
        mainBkg: "#eee8d5",
        nodeBorder: "#268bd2",
        clusterBkg: "#fdf6e3",
        clusterBorder: "#eee8d5",
        titleColor: "#657b83",
      },
    },
  },
  {
    name: "gruvbox-dark",
    kind: "dark",
    vars: {
      bg: "#282828",
      fg: "#ebdbb2",
      muted: "#928374",
      link: "#83a598",
      border: "#3c3836",
      codeBg: "#32302f",
      blockquote: "#928374",
    },
    shiki: "gruvbox-dark-medium",
    mermaid: {
      theme: "dark",
      themeVariables: {
        background: "#282828",
        primaryColor: "#3c3836",
        primaryTextColor: "#ebdbb2",
        primaryBorderColor: "#d79921",
        lineColor: "#83a598",
        textColor: "#ebdbb2",
        mainBkg: "#3c3836",
        nodeBorder: "#d79921",
        clusterBkg: "#282828",
        clusterBorder: "#504945",
        titleColor: "#ebdbb2",
      },
    },
  },
  {
    name: "gruvbox-light",
    kind: "light",
    vars: {
      bg: "#fbf1c7",
      fg: "#3c3836",
      muted: "#928374",
      link: "#076678",
      border: "#ebdbb2",
      codeBg: "#f2e5bc",
      blockquote: "#928374",
    },
    shiki: "gruvbox-light-medium",
    mermaid: {
      theme: "default",
      themeVariables: {
        background: "#fbf1c7",
        primaryColor: "#ebdbb2",
        primaryTextColor: "#3c3836",
        primaryBorderColor: "#b57614",
        lineColor: "#076678",
        textColor: "#3c3836",
        mainBkg: "#ebdbb2",
        nodeBorder: "#b57614",
        clusterBkg: "#fbf1c7",
        clusterBorder: "#d5c4a1",
        titleColor: "#3c3836",
      },
    },
  },
];

const THEME_MAP = new Map(THEMES.map((t) => [t.name, t]));

export const DEFAULT_THEME = "auto";

export function themeNames(): string[] {
  return THEMES.map((t) => t.name);
}

export function hasTheme(name: string | null | undefined): boolean {
  return !!name && THEME_MAP.has(name);
}

export function getTheme(name?: string | null): ThemeDef {
  return (name && THEME_MAP.get(name)) || THEME_MAP.get(DEFAULT_THEME)!;
}

export function resolveThemeName(
  query: string | null,
  cookie: string | null,
  fallback: string
): string {
  if (hasTheme(query)) {
    return query!;
  }
  if (hasTheme(cookie)) {
    return cookie!;
  }
  if (hasTheme(fallback)) {
    return fallback;
  }
  return DEFAULT_THEME;
}

export function shikiThemeNames(): string[] {
  const names = new Set<string>();
  for (const theme of THEMES) {
    if (theme.shiki) names.add(theme.shiki);
    if (theme.shikiLight) names.add(theme.shikiLight);
    if (theme.shikiDark) names.add(theme.shikiDark);
  }
  return [...names];
}
