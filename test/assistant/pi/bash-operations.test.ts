import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PiSandboxLimits } from "../../../src/assistant/pi/guard-limits.js";
import { useFakeSandboxBin } from "../../helpers/fake-commands.js";
import { useTempDir } from "../../helpers/temp.js";

interface ExecOptions {
  onData(data: Buffer): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

interface BashOperations {
  exec(command: string, cwd: string, options: ExecOptions): Promise<{ exitCode: number }>;
}

async function operations(sandbox: PiSandboxLimits, deniedCommands: string[] = []): Promise<BashOperations> {
  const path = resolve(process.cwd(), "src/assistant/pi/bash-operations.js");
  const module = (await import(path)) as {
    createBashOperations(sandbox: PiSandboxLimits, deniedCommands: string[]): BashOperations;
  };
  return module.createBashOperations(sandbox, deniedCommands);
}

function setup() {
  const root = useTempDir("tasker-pi-bash-ops-");
  const worktree = join(root, "worktree");
  const tempFolder = join(root, "temp");
  mkdirSync(join(worktree, ".git"), { recursive: true });
  mkdirSync(tempFolder);
  const bwrap = join(useFakeSandboxBin(), "bwrap");
  const argsLog = join(root, "bwrap-args");
  const sandbox: PiSandboxLimits = { bwrap, worktree, writePaths: [], tempFolder, hidePaths: [] };
  const env = { ...process.env, TASKER_FAKE_BWRAP_ARGS: argsLog, TASKER_TEST_VALUE: "passed" };
  return { root, worktree, sandbox, env, argsLog };
}

describe("createBashOperations", () => {
  it("returns an exitCode and sends Buffer output", async () => {
    const { worktree, sandbox, env } = setup();
    const chunks: Buffer[] = [];
    const ops = await operations(sandbox);

    await expect(ops.exec("echo hi", worktree, { onData: (chunk) => chunks.push(chunk), env })).resolves.toEqual({
      exitCode: 0,
    });
    expect(chunks.every((chunk) => Buffer.isBuffer(chunk))).toBe(true);
    expect(Buffer.concat(chunks).toString()).toBe("hi\n");
  });

  it("runs bwrap with the call cwd and env, forwards both streams, and returns the exit code", async () => {
    const { worktree, sandbox, env, argsLog } = setup();
    const chunks: Buffer[] = [];
    const ops = await operations(sandbox);

    const result = await ops.exec("printf out; printf err >&2; printf $TASKER_TEST_VALUE; pwd; exit 7", worktree, {
      onData: (chunk) => chunks.push(chunk),
      env,
    });

    expect(result).toEqual({ exitCode: 7 });
    expect(chunks.every((chunk) => Buffer.isBuffer(chunk))).toBe(true);
    expect(Buffer.concat(chunks).toString()).toContain("out");
    expect(Buffer.concat(chunks).toString()).toContain("err");
    expect(Buffer.concat(chunks).toString()).toContain("passed");
    expect(Buffer.concat(chunks).toString()).toContain(worktree);
    expect(readFileSync(argsLog, "utf8")).toContain(worktree);
  });

  it("rechecks final command text and spawns nothing for a denied command", async () => {
    const { worktree, sandbox, env, argsLog } = setup();
    const ops = await operations(sandbox, ["git push"]);
    const finalCommand = "git push";

    await expect(ops.exec(finalCommand, worktree, { onData: () => undefined, env })).rejects.toThrow(
      'tasker blocked this command: it runs "git push"',
    );
    expect(() => readFileSync(argsLog)).toThrow();
  });

  it("throws aborted before spawn when the signal is already aborted", async () => {
    const { worktree, sandbox, env, argsLog } = setup();
    const controller = new AbortController();
    controller.abort();
    const ops = await operations(sandbox);

    await expect(
      ops.exec("true", worktree, { onData: () => undefined, signal: controller.signal, env }),
    ).rejects.toThrow("aborted");
    expect(() => readFileSync(argsLog)).toThrow();
  });

  it("throws for a missing cwd without spawning bwrap", async () => {
    const { root, sandbox, env, argsLog } = setup();
    const ops = await operations(sandbox);

    await expect(ops.exec("true", join(root, "missing-cwd"), { onData: () => undefined, env })).rejects.toThrow();
    expect(() => readFileSync(argsLog)).toThrow();
  });

  it("kills the process group on abort", async () => {
    const { root, worktree, sandbox, env } = setup();
    const marker = join(root, "after-abort");
    const controller = new AbortController();
    const ops = await operations(sandbox);
    const result = ops.exec(`sleep 0.2; touch '${marker}'`, worktree, {
      onData: () => undefined,
      signal: controller.signal,
      env,
    });
    setTimeout(() => controller.abort(), 25);

    await expect(result).rejects.toThrow("aborted");
    await new Promise((done) => setTimeout(done, 250));
    expect(() => readFileSync(marker)).toThrow();
  });

  it("kills the process group on timeout", async () => {
    const { root, worktree, sandbox, env } = setup();
    const marker = join(root, "after-timeout");
    const ops = await operations(sandbox);

    await expect(
      ops.exec(`sleep 0.2; touch '${marker}'`, worktree, {
        onData: () => undefined,
        timeout: 0.025,
        env,
      }),
    ).rejects.toThrow("timeout:0.025");
    await new Promise((done) => setTimeout(done, 250));
    expect(() => readFileSync(marker)).toThrow();
  });

  it("treats the pi timeout as seconds and stops the process group", async () => {
    const { root, worktree, sandbox, env } = setup();
    const marker = join(root, "after-one-second-timeout");
    const ops = await operations(sandbox);
    const started = Date.now();

    await expect(
      ops.exec(`sleep 3; touch '${marker}'`, worktree, { onData: () => undefined, timeout: 1, env }),
    ).rejects.toThrow("timeout:1");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);
    await new Promise((done) => setTimeout(done, 100));
    expect(() => readFileSync(marker)).toThrow();
  });

  it("returns 128 plus a signal number when bwrap ends by signal", async () => {
    const { worktree, sandbox, env } = setup();
    writeFileSync(sandbox.bwrap, "#!/bin/sh\nkill -TERM $$\n", { mode: 0o755 });
    const ops = await operations(sandbox);

    await expect(ops.exec("true", worktree, { onData: () => undefined, env })).resolves.toEqual({ exitCode: 143 });
  });
});
