import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accept } from "../../src/commands/accept.js";
import { taskLockName } from "../../src/store/locks.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { addCloneCommit, commitInWorktree } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import { dayAt, databasePathOf, eventsOf, latestTaskOf, seedTasks, withDataRootStore } from "../helpers/store.js";
import {
  expectCommandRefused,
  taskBranchTipOf,
  useStartFixture,
  useWorkReviewTask,
  type WorkReviewTask,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const BASE = "refs/remotes/origin/main";

const runAccept = (key = KEY) => runCommand(accept, "accept", key, "--repo", REPO);

// The revision that ref names in the git dir of the clone.
const revisionOf = (work: Pick<WorkReviewTask, "clone" | "env">, ref: string) =>
  runGit(["rev-parse", ref], { gitDir: work.clone, env: work.env }).then((out) => out.trim());

// Appends a base event to the task.
const appendBase = (work: WorkReviewTask, base: string, revision: string) =>
  withDataRootStore(work.dataRoot, (store) =>
    store.appendEvent(work.task.id, "base", { base, revision, source: "explicit" }),
  );

// Runs accept and expects a refusal that changes nothing.
const expectRefused = (dataRoot: string, error: string | RegExp) =>
  expectCommandRefused({ dataRoot, key: KEY }, () => runAccept(), error);

describe("accept", () => {
  it("accepts a task whose branch contains the tip of the base", async () => {
    const work = await useWorkReviewTask();
    const head = await taskBranchTipOf(work);
    const before = eventsOf(work.dataRoot, KEY);

    const result = await runAccept();

    expect(result.code).toBe(0);
    expect(result.out).toBe(`accepted ${KEY} at ${head}\n`);
    expect(result.err).toBe("");
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("accepted");
    expect(eventsOf(work.dataRoot, KEY)).toEqual([
      ...before,
      {
        type: "accepted",
        data: {
          revision: head,
          baseTip: await revisionOf(work, BASE),
          from: "awaiting_work_review",
          to: "accepted",
        },
      },
    ]);
  });

  it("accepts a task whose base is a local branch at the tip", async () => {
    const work = await useWorkReviewTask();
    await runGit(["update-ref", "refs/heads/x", BASE], { gitDir: work.clone, env: work.env });
    appendBase(work, "refs/heads/x", "refs/heads/x");
    const tip = await revisionOf(work, "refs/heads/x");

    const result = await runAccept();

    expect(result.code).toBe(0);
    expect(latestTaskOf(work.dataRoot, KEY).state).toBe("accepted");
    expect(eventsOf(work.dataRoot, KEY).at(-1)?.data).toMatchObject({ baseTip: tip });
  });
});

describe("a refused accept", () => {
  it("refuses a task in another state", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [{ issueKey: KEY, repoKey: REPO, state: "workspace_ready", at: dayAt(1) }]);

    await expectRefused(
      fixture.dataRoot,
      `the task of ${KEY} is in workspace_ready; tasker accept needs awaiting_work_review\n`,
    );
  });

  it("refuses a second accept", async () => {
    const work = await useWorkReviewTask();
    expect((await runAccept()).code).toBe(0);

    await expectRefused(work.dataRoot, `the task of ${KEY} is in accepted; tasker accept needs awaiting_work_review\n`);
  });

  it("refuses a task with no worktree", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [{ issueKey: KEY, repoKey: REPO, state: "awaiting_work_review", at: dayAt(1) }]);

    await expectRefused(fixture.dataRoot, `the task of ${KEY} has no worktree\n`);
  });

  it("refuses a task with no branch", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [
      { issueKey: KEY, repoKey: REPO, state: "awaiting_work_review", at: dayAt(1), worktreePath: "/work/tree" },
    ]);

    await expectRefused(fixture.dataRoot, `the task of ${KEY} has no branch\n`);
  });

  it("refuses a task with no base revision", async () => {
    const fixture = await useStartFixture();
    seedTasks(fixture.dataRoot, [
      {
        issueKey: KEY,
        repoKey: REPO,
        state: "awaiting_work_review",
        at: dayAt(1),
        worktreePath: "/work/tree",
        branch: "tasker/five",
      },
    ]);

    await expectRefused(fixture.dataRoot, `the task of ${KEY} has no base revision\n`);
  });

  it("refuses a branch that does not contain the tip of a base that moved on origin", async () => {
    const work = await useWorkReviewTask();
    const head = await taskBranchTipOf(work);
    const tip = await work.origin.addCommit("main");

    await expectRefused(
      work.dataRoot,
      `the branch ${String(work.task.branch)} (${head}) does not contain the tip of the base ${BASE} (${tip})\n`,
    );
    expect(await revisionOf(work, BASE)).toBe(tip);
  });

  it("refuses a branch that does not contain a moved base, also when HEAD of the worktree does", async () => {
    const work = await useWorkReviewTask();
    const revision = await taskBranchTipOf(work);
    const tip = await work.origin.addCommit("main");
    await runGit(["fetch", "origin"], { gitDir: work.clone, env: work.env });
    await runGit(["switch", "--detach", BASE], { cwd: work.task.worktreePath!, env: work.env });
    await commitInWorktree(work.task.worktreePath!, work.env, { file: "detached.txt" });

    await expectRefused(
      work.dataRoot,
      `the branch ${String(work.task.branch)} (${revision}) does not contain the tip of the base ${BASE} (${tip})\n`,
    );
  });

  it("refuses a branch that does not contain the tip of a local base", async () => {
    const work = await useWorkReviewTask();
    const head = await taskBranchTipOf(work);
    await runGit(["update-ref", "refs/heads/x", BASE], { gitDir: work.clone, env: work.env });
    appendBase(work, "refs/heads/x", "refs/heads/x");
    const tip = await addCloneCommit(work.clone, work.env, "x");

    await expectRefused(
      work.dataRoot,
      `the branch ${String(work.task.branch)} (${head}) does not contain the tip of the base refs/heads/x (${tip})\n`,
    );
  });

  it("refuses a base that origin does not have", async () => {
    const work = await useWorkReviewTask();
    appendBase(work, "gone", "refs/remotes/origin/gone");

    await expectRefused(
      work.dataRoot,
      "cannot read the base tip: cannot resolve the revision: refs/remotes/origin/gone\n",
    );
  });

  it("refuses when the fetch fails and keeps the base tip", async () => {
    const work = await useWorkReviewTask();
    const before = await revisionOf(work, BASE);
    renameSync(work.origin.path, `${work.origin.path}-moved`);

    await expectRefused(work.dataRoot, /^cannot read the base tip: /);
    expect(await revisionOf(work, BASE)).toBe(before);
  });

  it("fails at once when another process holds the task lock", async () => {
    const work = await useWorkReviewTask();
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(work.dataRoot), name);
    await holder.attempt;

    await expectRefused(work.dataRoot, new RegExp(`^the lock ${name} is busy`));
  });
});
