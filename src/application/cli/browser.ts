function openers(): string[][] {
  if (process.platform === "darwin") {
    return [["open"]];
  }
  if (process.platform === "win32") {
    return [["explorer.exe"]];
  }
  return [["xdg-open"], ["open"], ["explorer.exe"]];
}

export function openInBrowser(url: string): boolean {
  for (const [command] of openers()) {
    try {
      const child = Bun.spawn([command!, url], {
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      });
      child.unref();
      return true;
    } catch {
      /* try the next opener */
    }
  }
  return false;
}
