import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { merge } from "../../src/commands/merge.js";
import { failedFrom, lastTransitionError } from "../../src/state/machine.js";
import { taskLockName } from "../../src/store/locks.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand } from "../helpers/cli.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  dayAt,
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import {
  expectCommandRefused,
  useAcceptedTask,
  useStartFixture,
  useWorkReviewTask,
  type AcceptedTask,
  type StartFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";

const runMerge = (key = KEY) => runCommand(merge, "merge", key, "--repo", REPO);

// The error of the last transition event of the task.
const errorOf = (task: Pick<AcceptedTask, "dataRoot" | "task">) =>
  withDataRootStore(task.dataRoot, (store) => lastTransitionError(store.listEvents(task.task.id)));

// Runs merge, expects a refusal that changes nothing, and expects no run marker and the same head of main on origin.
const expectRefused = async (fixture: Pick<StartFixture, "dataRoot" | "origin">, error: string | RegExp) => {
  const head = await fixture.origin.branchHead("main");

  await expectCommandRefused({ dataRoot: fixture.dataRoot, key: KEY }, runMerge, error);

  expect(readRunMarker(databasePathOf(fixture.dataRoot), latestTaskOf(fixture.dataRoot, KEY).id)).toBeUndefined();
  expect(await fixture.origin.branchHead("main")).toBe(head);
};

// Seeds the task of issue 5 in accepted, with the given branch and base.
const seedAccepted = (fixture: StartFixture, extra: { branch?: string; base?: string } = {}) =>
  seedTasks(fixture.dataRoot, [{ issueKey: KEY, repoKey: REPO, state: "accepted", at: dayAt(1), ...extra }]);

// Makes the head of the task branch the head of main on origin, as a push by someone else would.
const landByOthers = (accepted: AcceptedTask) =>
  runGit(["fetch", accepted.clone, `refs/heads/${String(accepted.task.branch)}:refs/heads/main`], {
    gitDir: accepted.origin.path,
    env: accepted.env,
  });

describe("tasker merge", () => {
  it("lands the work on the base of origin and moves the task to landed", async () => {
    const accepted = await useAcceptedTask();
    const before = eventsOf(accepted.dataRoot, KEY);

    const result = await runMerge();

    expect(result).toEqual({
      code: 0,
      out: `merged ${KEY}\nlanded: ${accepted.revision} on origin/main\n`,
      err: "",
    });
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    const events = eventsOf(accepted.dataRoot, KEY);
    expect(events.slice(0, before.length)).toEqual(before);
    expect(events.slice(before.length)).toMatchObject([
      { type: "transition", data: { from: "accepted", to: "merging" } },
      {
        type: "landed",
        data: { revision: accepted.revision, base: "main", pushed: true, from: "merging", to: "landed" },
      },
    ]);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("pushes nothing when the work is already on the base", async () => {
    const accepted = await useAcceptedTask();
    await landByOthers(accepted);

    const result = await runMerge();

    expect(result).toEqual({
      code: 0,
      out: `merged ${KEY}\nalready on origin/main: ${accepted.revision}. Nothing pushed.\n`,
      err: "",
    });
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)).toMatchObject({
      type: "landed",
      data: { revision: accepted.revision, base: "main", pushed: false, from: "merging", to: "landed" },
    });
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task from merging when the base moved on origin after accept", async () => {
    const accepted = await useAcceptedTask();
    const tip = await accepted.origin.addCommit("main");

    const result = await runMerge();

    const error = `merging failed: cannot land ${accepted.revision} on the base branch: main: the revision does not build on the tip of the base on origin: ${tip}`;
    expect(result).toEqual({ code: 1, out: "", err: `${error}\n` });
    expect(errorOf(accepted)).toBe(error);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(await accepted.origin.branchHead("main")).toBe(tip);
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
  });

  it("fails the task from merging when the fetch fails", async () => {
    const accepted = await useAcceptedTask();
    const head = await accepted.origin.branchHead("main");
    renameSync(accepted.origin.path, `${accepted.origin.path}-moved`);

    const result = await runMerge();

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err.startsWith("merging failed: ")).toBe(true);
    expect(errorOf(accepted)).toBe(result.err.trimEnd());
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("failed");
    withDataRootStore(accepted.dataRoot, (store) => expect(failedFrom(store, accepted.task.id)).toBe("merging"));
    expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
    const moved = await runGit(["rev-parse", "refs/heads/main"], {
      gitDir: `${accepted.origin.path}-moved`,
      env: accepted.env,
    });
    expect(moved.trim()).toBe(head);
  });

  describe("refusals", () => {
    it("refuses a task that is not in accepted", async () => {
      const work = await useWorkReviewTask();

      await expectRefused(work, `the task of ${KEY} is in awaiting_work_review; tasker merge needs accepted\n`);
    });

    it("refuses a task with no branch", async () => {
      const fixture = await useStartFixture();
      seedAccepted(fixture);

      await expectRefused(fixture, `the task of ${KEY} has no branch\n`);
    });

    it("refuses a task with no base", async () => {
      const fixture = await useStartFixture();
      seedAccepted(fixture, { branch: "tasker/five" });

      await expectRefused(fixture, `the task of ${KEY} has no base\n`);
    });

    it("refuses a base that is a local branch of the clone", async () => {
      const fixture = await useStartFixture();
      seedAccepted(fixture, { branch: "tasker/five", base: "refs/heads/x" });

      await expectRefused(
        fixture,
        `the base of ${KEY} is a local branch of the clone: refs/heads/x; tasker merge pushes only to a branch on origin\n`,
      );
    });

    it("refuses a task with no base revision", async () => {
      const fixture = await useStartFixture();
      seedAccepted(fixture, { branch: "tasker/five", base: "main" });

      await expectRefused(fixture, `the task of ${KEY} has no base revision\n`);
    });

    it("fails at once when another process holds the task lock", async () => {
      const accepted = await useAcceptedTask();
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
      await holder.attempt;

      await expectRefused(accepted, new RegExp(`^the lock ${name} is busy`));
    });
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, out } = await runCommand(merge, "merge", "--help");

    expect(code).toBe(0);
    // Commander wraps the long lines of the help, so compare with single spaces.
    const help = out.replace(/\s+/g, " ");
    expect(help).toContain(
      "Land the work of a task in accepted on the base branch of origin with one fast-forward push: the task goes through merging to landed, or to failed. tasker does not wait for CI",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
