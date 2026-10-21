import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readDaemonState } from "../src/core/state";

const CLI = join(import.meta.dir, "..", "src/application/cli/index.ts");

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: string[],
  env: Record<string, string>,
  stdin?: string
): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, ...env },
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (stdin !== undefined) {
    child.stdin?.write(stdin);
    child.stdin?.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout as ReadableStream<Uint8Array>).text(),
    new Response(child.stderr as ReadableStream<Uint8Array>).text(),
    child.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function waitUntil(check: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await Bun.sleep(25);
  }
  return check();
}

describe("register command", () => {
  it("registers stdin content and serves it from the daemon", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-register-"));
    const stateFile = join(dir, "state", "daemon.json");
    const docPath = join(dir, "doc.md");
    const marker = `register-marker-${Date.now()}`;
    const content = `# ${marker}\n`;
    writeFileSync(docPath, content);
    const env = {
      MDPRV_PORT: "0",
      MDPRV_STATE: stateFile,
      MDPRV_IDLE: "1",
    };

    try {
      const result = await runCli(
        ["register", "--stdin", "--slug", "e2e/doc", "--path", docPath],
        env,
        content
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toBe("e2e/doc\n");

      expect(await waitUntil(() => readDaemonState(stateFile) !== null)).toBe(true);
      const state = readDaemonState(stateFile);
      expect(state).not.toBeNull();
      const base = `http://127.0.0.1:${state!.port}`;

      const page = await fetch(`${base}/e2e/doc`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain(marker);

      const health = await fetch(`${base}/__health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as { status?: unknown; version?: unknown };
      expect(body.status).toBe("ok");
      expect(typeof body.version).toBe("string");

      await fetch(`${base}/__shutdown`, {
        method: "POST",
        headers: { "x-mdprv-token": state!.token },
      });
      expect(await waitUntil(() => readDaemonState(stateFile) === null)).toBe(true);
    } finally {
      const state = readDaemonState(stateFile);
      if (state) {
        try {
          await fetch(`http://127.0.0.1:${state.port}/__shutdown`, {
            method: "POST",
            headers: { "x-mdprv-token": state.token },
          });
        } catch {
          /* already gone */
        }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  it("fails with a clear error when --slug is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdprv-register-err-"));
    try {
      const result = await runCli(
        ["register", "--stdin"],
        {
          MDPRV_PORT: "0",
          MDPRV_STATE: join(dir, "state", "daemon.json"),
          MDPRV_IDLE: "1",
        },
        "# no slug\n"
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);
});
