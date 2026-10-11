import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, GitNotInstalledError, runGit } from "../../../src/vcs/git/run.js";
import { gitTestEnv, makeTempDir, repoRoot, writeFakeGit } from "../../helpers.js";

describe("runGit", () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-run-git-");
    env = gitTestEnv(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs in cwd and resolves with stdout", async () => {
    const out = await runGit(["init", "--initial-branch=main"], { cwd: dir, env });
    expect(out).toContain("Initialized empty Git repository");
  });

  it("runs against a git dir and does not trim stdout", async () => {
    await runGit(["init", "--initial-branch=main"], { cwd: dir, env });
    const out = await runGit(["rev-parse", "--is-bare-repository"], {
      gitDir: join(dir, ".git"),
      env,
    });
    expect(out).toBe("false\n");
  });

  it("rejects with a GitError that names the subcommand and holds the output", async () => {
    const error = await runGit(["rev-parse", "HEAD"], {
      gitDir: join(dir, "missing.git"),
      env,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitError);
    const gitError = error as GitError;
    expect(gitError.message).toContain("git rev-parse failed with exit code");
    expect(gitError.message).toContain("not a git repository");
    expect(gitError.subcommand).toBe("rev-parse");
    expect(gitError.stderr).toContain("not a git repository");
    expect(gitError.stdout).toBe("");
  });

  it("rejects empty args", async () => {
    await expect(runGit([], { cwd: dir, env })).rejects.toThrow("runGit needs a git subcommand");
  });

  it("rejects args that start with an option", async () => {
    await expect(runGit(["-c", "x.y=z", "status"], { cwd: dir, env })).rejects.toThrow(
      "runGit needs the git subcommand as the first argument",
    );
  });

  it("reports that git is not installed when git is not on PATH", async () => {
    const emptyPath = join(dir, "empty-bin");
    mkdirSync(emptyPath);
    const error = await runGit(["version"], {
      cwd: dir,
      env: { ...env, PATH: emptyPath },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect((error as Error).message).toBe("git is not installed: git was not found on PATH");
  });

  it("reports that git is not installed when the env has no PATH", async () => {
    const withoutPath = { ...env };
    delete withoutPath.PATH;
    const error = await runGit(["version"], { cwd: dir, env: withoutPath }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect((error as Error).message).toBe("git is not installed: the env has no PATH");
  });

  it("reports that git is not installed when PATH is empty", async () => {
    const error = await runGit(["version"], { cwd: dir, env: { ...env, PATH: "" } }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(GitNotInstalledError);
    expect((error as Error).message).toBe("git is not installed: the env has no PATH");
  });

  it("reports a missing working folder, not a missing git", async () => {
    const missing = join(dir, "no-such-folder");
    const error = await runGit(["status"], { cwd: missing, env }).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(GitNotInstalledError);
    expect((error as Error).message).toBe(`the working folder does not exist: ${missing}`);
  });

  it("writes nothing to the terminal, also when git fails", async () => {
    const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "test/fixtures/git-quiet.ts"], {
          cwd: repoRoot,
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    expect(result).toEqual({ code: 0, stdout: "", stderr: "" });
  });
});

describe("runGit keeps git away from the terminal", () => {
  let dir: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    dir = makeTempDir("tasker-run-git-tty-");
    bin = join(dir, "bin");
    env = { ...gitTestEnv(dir), PATH: bin, GIT_TERMINAL_PROMPT: "1" };
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("sets GIT_TERMINAL_PROMPT to 0 and gives git no controlling terminal", async () => {
    writeFakeGit(
      bin,
      [
        'echo "prompt=$GIT_TERMINAL_PROMPT"',
        'if [ -e /dev/tty ] && (: < /dev/tty) 2>/dev/null; then echo tty; else echo no-tty; fi',
      ].join("\n"),
    );
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toBe("prompt=0\nno-tty\n");
  });

  it.runIf(existsSync("/proc/self/stat"))("starts git in its own session", async () => {
    writeFakeGit(
      bin,
      [
        "read -r pid comm state ppid pgrp session rest < /proc/$$/stat",
        'if [ "$session" = "$$" ]; then echo own-session; else echo shared-session; fi',
      ].join("\n"),
    );
    const out = await runGit(["version"], { cwd: dir, env });
    expect(out).toBe("own-session\n");
  });
});
