import { describe, expect, it } from "vitest";
import { GitError } from "../../src/vcs/git/run.js";
import { failureOf } from "./errors.js";
import { gitOutput } from "./git.js";
import { startConflictedReopenResync } from "./reopen-resync.js";
import { taskBranchTipOf, useRefineFixture } from "./task-fixtures.js";
import { answerStream, validPlanAnswer } from "./plan.js";

describe("startConflictedReopenResync", () => {
  it("returns the starting HEAD and leaves an unfinished detached resync", async () => {
    const fixture = await useRefineFixture({ stream: answerStream(validPlanAnswer()) });
    const startHead = await startConflictedReopenResync(fixture);
    const path = String(fixture.task.worktreePath);

    expect(await taskBranchTipOf({ clone: fixture.started.clone, env: fixture.started.env, task: fixture.task })).toBe(
      startHead,
    );
    expect(await gitOutput({ cwd: path }, fixture.started.env, "status", "--porcelain")).toContain(
      "reopen-conflict.txt",
    );
    await failureOf(gitOutput({ cwd: path }, fixture.started.env, "symbolic-ref", "-q", "HEAD"), GitError);
  });
});
