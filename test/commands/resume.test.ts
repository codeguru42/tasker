import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resume } from "../../src/commands/resume.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { canonicalPath } from "../../src/real-path.js";
import { type TransitionDetail } from "../../src/state/machine.js";
import { GitError } from "../../src/vcs/git/run.js";
import { removeTaskWorktree } from "../../src/vcs/git/worktree.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { failureOf } from "../helpers/errors.js";
import { commitInWorktree, gitOutput } from "../helpers/git.js";
import {
  executedLine,
  plannedLine,
  refinedLine,
  resumedLine,
  reviewedLinePrefix,
  verifiedLine,
} from "../helpers/command-output.js";
import { argAfter, TEST_EXECUTE_SESSION_ID, TEST_REVIEW_SESSION_ID, TEST_SESSION_ID } from "../helpers/fake-claude.js";
import {
  answerStream,
  planTodo,
  seedExecuteSession,
  seedExecuteTodoStates,
  seedReviewSession,
  turnResultStream,
  validPlanAnswer,
} from "../helpers/plan.js";
import { validReviewAnswer } from "../helpers/review.js";
import { deadRunNote, wrongStateError } from "../helpers/state-commands.js";
import {
  eventDataOf,
  eventsOf,
  latestTaskOf,
  pauseRefineFrom,
  pauseTaskFrom,
  pauseTaskVia,
  reviewSessionRows,
  seedDeadRun,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  unacceptedTipError,
  pausePlanFixtureTask,
  taskBranchTipOf,
  useAcceptedTask,
  useExecuteFixture,
  useLandedTask,
  useMovedBaseTask,
  usePlanFixture,
  useRefineFixture,
  useReviewedRefineFixture,
  useReviewFixture,
  useVerifyFixture,
  useWorkReviewTask,
  type WorkReviewTask,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const FEEDBACK = "Keep the loop.";
const TODOS = [planTodo("a"), planTodo("b", ["a"])];
const PAUSES = ["quota_blocked", "interrupted"] as const;

const runResume = (key = KEY, ...extra: string[]) => runCommand(resume, "resume", key, ...extra);

const V2_ANSWER = validPlanAnswer({
  plan_markdown: "## Summary\n\nAdd the b module and its test, test first.\n",
  todos: [{ id: "only-todo", title: "Do the work", description: "Do all of it.", depends_on: [] }],
  questions: [],
});

describe("tasker resume", () => {
  it.each(PAUSES)("continues the plan session for a task paused in %s from planning", async (pause) => {
    const fixture = await usePlanFixture({ stream: answerStream(validPlanAnswer()) });
    const { dataRoot } = fixture.started;
    pausePlanFixtureTask(fixture, "planning", pause);

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(resumedLine(KEY, "planning", "workspace_ready"))).toBe(true);
    expect(result.out).toContain(plannedLine(KEY, 1));
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_SESSION_ID);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_plan_review");
    expect(eventDataOf(dataRoot, KEY, "resume")).toEqual([{ origin: "planning", target: "workspace_ready" }]);
  });

  describe("a task paused in refining", () => {
    const plainOrigins = ["awaiting_plan_review", "failed"] as const;
    const plainCases = PAUSES.flatMap((pause) => plainOrigins.map((refineOrigin) => ({ pause, refineOrigin })));

    it.each(plainCases)(
      "runs the same refine with the recorded feedback for $refineOrigin in $pause",
      async ({ pause, refineOrigin }) => {
        const fixture = await useRefineFixture({ stream: answerStream(V2_ANSWER) });
        withDataRootStore(fixture.started.dataRoot, (store) =>
          pauseRefineFrom(store, fixture.task.id, refineOrigin, pause, FEEDBACK),
        );

        const result = await runResume();

        expect(result.code).toBe(0);
        expect(result.out.startsWith(resumedLine(KEY, "refining", "awaiting_plan_review"))).toBe(true);
        expect(result.out).toContain(refinedLine(KEY, 2));
        const calls = fixture.claude.calls();
        expect(calls).toHaveLength(1);
        expect(calls[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
        expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_SESSION_ID);
        expect(latestTaskOf(fixture.started.dataRoot, KEY).state).toBe("awaiting_plan_review");
      },
    );

    it.each(PAUSES)("runs the refine of findings with the recorded feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture({ stream: answerStream(V2_ANSWER) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "reviewed", pause, FEEDBACK),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out.startsWith(resumedLine(KEY, "refining", "reviewed"))).toBe(true);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
    });

    it.each(PAUSES)("runs the refine of findings with no feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture({ stream: answerStream(V2_ANSWER) });
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "reviewed", pause),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain("<feedback>None.</feedback>");
    });

    it.each(PAUSES)("runs the feedback form of review with the recorded feedback in %s", async (pause) => {
      const fixture = await useReviewedRefineFixture(
        { stream: answerStream(V2_ANSWER) },
        { state: "awaiting_work_review", review: null },
      );
      withDataRootStore(fixture.started.dataRoot, (store) =>
        pauseRefineFrom(store, fixture.task.id, "awaiting_work_review", pause, FEEDBACK),
      );

      const result = await runResume();

      expect(result.code).toBe(0);
      expect(result.out.startsWith(resumedLine(KEY, "refining", "awaiting_work_review"))).toBe(true);
      expect(result.out).toContain(refinedLine(KEY, 2));
      expect(fixture.claude.calls()[0].stdin).toContain(`<feedback>${FEEDBACK}</feedback>`);
    });
  });

  it.each(PAUSES)("continues the execute session and gives no turn to a done todo in %s", async (pause) => {
    const fixture = await useExecuteFixture({ stream: turnResultStream("done") }, { answer: { todos: TODOS } });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => {
      seedExecuteSession(store, fixture.task.id, 1);
      seedExecuteTodoStates(store, fixture.task.id, 1, { a: "done" });
      pauseTaskFrom(store, fixture.task.id, "executing", pause);
    });

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(resumedLine(KEY, "executing", "approved"))).toBe(true);
    expect(result.out).toContain(executedLine(KEY, 1));
    expect(result.out).toContain("todos: 2 of 2 done");
    const calls = fixture.claude.calls();
    expect(calls).toHaveLength(1);
    expect(argAfter(calls[0].argv, "--resume")).toBe(TEST_EXECUTE_SESSION_ID);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("executed");
  });

  it("runs the verify again for a task paused in interrupted from verifying", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, fixture.task.id, "verifying", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out.startsWith(resumedLine(KEY, "verifying", "executed"))).toBe(true);
    expect(result.out).toContain(verifiedLine(KEY, 1));
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  describe("a task paused in interrupted from updating_branch", () => {
    const restoredLine = (tip: string) => `restored the worktree of ${KEY} to ${tip}\n`;
    const hint = `run tasker update-branch ${KEY} again\n`;
    const resumedOut = (tip: string) =>
      resumedLine(KEY, "updating_branch", "awaiting_work_review") + restoredLine(tip) + hint;

    // Writes the move into updating_branch with the head tip, as tasker update-branch does. It writes the event only.
    // seedDeadRun then leaves the state and the dead run marker of the crash.
    const recordUpdate = (work: WorkReviewTask, tip: string) =>
      withDataRootStore(work.dataRoot, (store) =>
        store.appendEvent(work.task.id, "transition", {
          head: tip,
          from: "awaiting_work_review",
          to: "updating_branch",
        }),
      );

    const pauseUpdate = (work: WorkReviewTask, detail?: TransitionDetail) =>
      withDataRootStore(work.dataRoot, (store) =>
        pauseTaskVia(store, work.task.id, "awaiting_work_review", "updating_branch", detail),
      );

    it("puts back a moved head and an untracked file after a crash", async () => {
      const work = await useWorkReviewTask();
      const path = String(work.task.worktreePath);
      const tip = await taskBranchTipOf(work);
      recordUpdate(work, tip);
      seedDeadRun(work.dataRoot, work.task.id, "updating_branch");
      await commitInWorktree(path, work.env, { file: "moved.txt" });
      writeFileSync(join(path, "untracked.txt"), "x\n");

      const result = await runResume();

      expect(result).toEqual({
        code: 0,
        out: resumedOut(tip),
        err: `${deadRunNote(KEY, "updating_branch")}\n`,
      });
      expect(await taskBranchTipOf(work)).toBe(tip);
      expect(existsSync(join(path, "untracked.txt"))).toBe(false);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
      expect(eventDataOf(work.dataRoot, KEY, "resume").at(-1)).toEqual({
        origin: "updating_branch",
        target: "awaiting_work_review",
        head: tip,
      });
    });

    it("puts back a worktree that a rebase stopped on a conflict", async () => {
      const work = await useMovedBaseTask({ baseChange: { file: "shared.txt", content: "base\n" } });
      const path = String(work.task.worktreePath);
      await commitInWorktree(path, work.env, { file: "shared.txt", content: "task\n" });
      const tip = await taskBranchTipOf(work);
      await gitOutput({ cwd: path }, work.env, "fetch", "origin");
      await failureOf(gitOutput({ cwd: path }, work.env, "rebase", work.baseTip), GitError);
      pauseUpdate(work, { head: tip });

      const result = await runResume();

      expect(result).toEqual({ code: 0, out: resumedOut(tip), err: "" });
      const rebaseDir = await gitOutput({ cwd: path }, work.env, "rev-parse", "--git-path", "rebase-merge");
      expect(existsSync(resolve(path, rebaseDir))).toBe(false);
      expect(await gitOutput({ cwd: path }, work.env, "symbolic-ref", "HEAD")).toBe(
        `refs/heads/${String(work.task.branch)}`,
      );
      expect(await gitOutput({ cwd: path }, work.env, "rev-parse", "HEAD")).toBe(tip);
      expect(await gitOutput({ cwd: path }, work.env, "status", "--porcelain")).toBe("");
    });

    it("keeps a worktree that is already at the head", async () => {
      const work = await useWorkReviewTask();
      const tip = await taskBranchTipOf(work);
      pauseUpdate(work, { head: tip });

      const result = await runResume();

      expect(result).toEqual({ code: 0, out: resumedOut(tip), err: "" });
      expect(await taskBranchTipOf(work)).toBe(tip);
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("awaiting_work_review");
    });

    it("refuses an update that recorded no start head", async () => {
      const work = await useWorkReviewTask();
      pauseUpdate(work);
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runResume();

      expect(result).toEqual({
        code: 1,
        out: "",
        err: `the update of ${KEY} recorded no start head; tasker resume cannot restore the worktree\n`,
      });
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("interrupted");
      expect(eventsOf(work.dataRoot, KEY)).toHaveLength(count);
    });

    it("writes nothing when the restore fails", async () => {
      const work = await useWorkReviewTask();
      const path = String(work.task.worktreePath);
      const tip = await taskBranchTipOf(work);
      pauseUpdate(work, { head: tip });
      await commitInWorktree(path, work.env, { file: "moved.txt" });
      writeFileSync(join(work.clone, "refs", "heads", `${String(work.task.branch)}.lock`), "");
      const count = eventsOf(work.dataRoot, KEY).length;

      const result = await runResume();

      expect(result.code).toBe(1);
      expect(result.out).toBe("");
      expect(result.err.startsWith("cannot restore the worktree:")).toBe(true);
      expect(result.err).toContain("Run these git commands");
      expect(latestTaskOf(work.dataRoot, KEY).state).toBe("interrupted");
      expect(eventsOf(work.dataRoot, KEY)).toHaveLength(count);
    });
  });

  it.each(PAUSES)("runs the review in a new session for a task paused in %s from reviewing", async (pause) => {
    const work = await useReviewFixture({ stream: answerStream(validReviewAnswer()) });
    const { dataRoot } = work;
    withDataRootStore(dataRoot, (store) => {
      seedReviewSession(store, work.task.id, 1);
      pauseTaskFrom(store, work.task.id, "reviewing", pause);
    });

    const result = await runResume(work.key);

    expect(result.code).toBe(0);
    expect(result.out.startsWith(resumedLine(KEY, "reviewing", "awaiting_work_review"))).toBe(true);
    expect(result.out).toContain(reviewedLinePrefix(KEY, 1));
    const calls = work.claude.calls();
    expect(calls).toHaveLength(1);
    const sessionId = argAfter(calls[0].argv, "--session-id");
    expect(sessionId).not.toBe(TEST_REVIEW_SESSION_ID);
    expect(calls[0].argv).not.toContain("--resume");
    expect(reviewSessionRows(dataRoot, work.task.id)).toMatchObject([{ review_number: 1, session_id: sessionId }]);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");
  });

  it("runs tasker merge for a task paused in interrupted from merging", async () => {
    const accepted = await useAcceptedTask();
    withDataRootStore(accepted.dataRoot, (store) => pauseTaskVia(store, accepted.task.id, "accepted", "merging"));

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      resumedLine(KEY, "merging", "accepted") + `merged ${KEY}\nlanded: ${accepted.revision} on origin/main\n`,
    );
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(eventDataOf(accepted.dataRoot, KEY, "resume")).toEqual([{ origin: "merging", target: "accepted" }]);
  });

  it("refuses a tip that is not the accepted revision after a paused merge", async () => {
    const accepted = await useAcceptedTask();
    withDataRootStore(accepted.dataRoot, (store) => pauseTaskVia(store, accepted.task.id, "accepted", "merging"));
    const tip = await commitInWorktree(accepted.task.worktreePath!, accepted.env, { file: "late.txt" });
    const head = await accepted.origin.branchHead("main");

    const result = await runResume();

    expect(result.code).toBe(1);
    expect(result.err).toContain(`${unacceptedTipError(accepted.task.branch!, tip, accepted.revision)}\n`);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
    expect(await accepted.origin.branchHead("main")).toBe(head);

    const updated = await runCommand(updateBranch, "update-branch", KEY, "--repo", "codeguru42/tasker");
    expect(updated.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("executed");
  });

  it("runs tasker finish for a task paused in interrupted from finishing", async () => {
    const landed = await useLandedTask();
    const { dataRoot, task, worktree, branch } = landed;
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, task.id, "finishing", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      resumedLine(KEY, "finishing", "landed") +
        `removed the worktree ${canonicalPath(worktree)}\ndeleted the branch ${branch}\nfinished ${KEY}\n`,
    );
    expect(latestTaskOf(dataRoot, KEY).state).toBe("finished");
    expect(eventDataOf(dataRoot, KEY, "resume")).toEqual([{ origin: "finishing", target: "landed" }]);
  });

  it("runs only the branch step for a task paused in interrupted from finishing after the worktree was removed", async () => {
    const landed = await useLandedTask();
    const { dataRoot, task, worktree, branch } = landed;
    await removeTaskWorktree({ clone: landed.clone, env: landed.env, path: worktree });
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, task.id, "finishing", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.out).toBe(
      resumedLine(KEY, "finishing", "landed") + `deleted the branch ${branch}\nfinished ${KEY}\n`,
    );
  });

  it("moves a task with a dead run to interrupted, then resumes it", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;
    seedDeadRun(dataRoot, fixture.task.id, "verifying");

    const result = await runResume();

    expect(result.code).toBe(0);
    expect(result.err).toContain(deadRunNote(KEY, "verifying"));
    expect(result.out.startsWith(resumedLine(KEY, "verifying", "executed"))).toBe(true);
    withDataRootStore(dataRoot, (store) => expect(store.latestVerifyRun(fixture.task.id)?.number).toBe(1));
  });

  it("keeps the error and the exit code of a next command that fails", async () => {
    const fixture = await useVerifyFixture({ commands: ["false"] });
    const { dataRoot } = fixture.started;
    withDataRootStore(dataRoot, (store) => pauseTaskFrom(store, fixture.task.id, "verifying", "interrupted"));

    const result = await runResume();

    expect(result.code).toBe(1);
    expect(result.out).toBe(resumedLine(KEY, "verifying", "executed"));
    expect(result.err).toContain("verify command 1 failed: false: exit code 1.");
    expect(latestTaskOf(dataRoot, KEY).state).toBe("failed");
    withDataRootStore(dataRoot, (store) => expect(store.latestVerifyRun(fixture.task.id)?.number).toBe(1));
  });

  it("refuses a task that is not paused and changes nothing", async () => {
    const fixture = await useVerifyFixture({ commands: ["true"] });
    const { dataRoot } = fixture.started;

    await expectCommandRefused(
      { dataRoot, key: KEY },
      () => runResume(),
      `${wrongStateError("executed", KEY, "resume", "quota_blocked or interrupted")}\n`,
    );
  });

  it("prints the description of the command and of its repo option for --help", async () => {
    const { code, help } = await runHelp(resume, "resume");

    expect(code).toBe(0);
    expect(help).toContain(
      "Move a task in quota_blocked or interrupted back to the state before the run that stopped, and run the same command again. A resume from updating_branch runs nothing",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
