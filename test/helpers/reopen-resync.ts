import type { RefineFixture } from "./task-fixtures.js";
import { commitInWorktree, gitOutput } from "./git.js";
import { failureOf } from "./errors.js";
import { GitError } from "../../src/vcs/git/run.js";

// Creates a conflicting reopen resync and returns the HEAD that tasker recorded before the resync.
// Call it inside a test. The fixture supplies the Git identity and environment.
export async function startConflictedReopenResync(fixture: Pick<RefineFixture, "task" | "started">): Promise<string> {
  const { task, started } = fixture;
  const path = String(task.worktreePath);
  await commitInWorktree(path, started.env, { file: "reopen-conflict.txt", content: "task\n" });
  const startHead = await gitOutput({ cwd: path }, started.env, "rev-parse", "HEAD");
  await started.origin.addCommit("main", { file: "reopen-conflict.txt", content: "base\n" });
  await gitOutput({ cwd: path }, started.env, "fetch", "origin");
  await failureOf(gitOutput({ cwd: path }, started.env, "rebase", "origin/main"), GitError);
  return startHead;
}
