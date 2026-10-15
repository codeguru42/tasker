// A child process for the runGit quiet test. It calls runGit and prints nothing unless a call goes wrong.
import { rmSync } from "node:fs";
import { join } from "node:path";
import { GitError, runGit } from "../../src/vcs/git/run.js";
import { gitTestEnv } from "../helpers/git.js";
import { makeTempDir } from "../helpers/temp.js";

// Waits for promise. It must reject with a GitError, so that git really started and failed.
async function expectGitError(promise: Promise<unknown>): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof GitError)) {
    process.exitCode = 1;
    throw error ?? new Error("git was expected to fail, but it succeeded");
  }
}

const dir = makeTempDir("tasker-git-quiet-");
try {
  const env = gitTestEnv(dir);
  const source = join(dir, "source");
  await runGit(["init", "--initial-branch=main", source], { cwd: dir, env });
  await runGit(["commit", "--allow-empty", "-m", "first"], { cwd: source, env });
  // git clone writes "Cloning into ..." to stderr on success.
  await runGit(["clone", source, join(dir, "copy")], { cwd: dir, env });
  // A failing git must not write to the terminal either.
  await expectGitError(
    runGit(["rev-parse", "--verify", "no-such-ref"], { cwd: join(dir, "copy"), env }),
  );
  await expectGitError(runGit(["checkout", "no-such-branch"], { cwd: source, env }));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
