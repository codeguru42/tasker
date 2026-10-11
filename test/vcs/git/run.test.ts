import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGit } from "../../../src/vcs/git/run.js";
import { gitTestEnv, makeTempDir, repoRoot } from "../../helpers.js";

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
