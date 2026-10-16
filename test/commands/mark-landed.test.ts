import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markLanded } from "../../src/commands/mark-landed.js";
import { taskLockName } from "../../src/store/locks.js";
import { runGit } from "../../src/vcs/git/run.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { startLockHolder } from "../helpers/processes.js";
import { databasePathOf, eventsOf, latestTaskOf, readRunMarker, withDataRootStore } from "../helpers/store.js";
import {
  appendBaseEvent,
  expectCommandRefused,
  landAcceptedTask,
  moveTaskThrough,
  seedAcceptedTask,
  useAcceptedTask,
  useStartFixture,
  useWorkReviewTask,
  type StartFixture,
} from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const NEEDS = "accepted, pushed or in_peer_review";

const runMarkLanded = () => runCommand(markLanded, "mark-landed", KEY, "--repo", REPO);

// Runs mark-landed and expects a refusal that changes nothing.
const expectRefused = (fixture: Pick<StartFixture, "dataRoot">, error: string | RegExp) =>
  expectCommandRefused({ dataRoot: fixture.dataRoot, key: KEY }, runMarkLanded, error);

// Lands the work, moves the task through states, and expects mark-landed to record the landing from the last state.
// It also expects that origin keeps the head of main and that no run marker stays.
const expectMarkedFrom = async (states: Parameters<typeof moveTaskThrough>[2], from: string) => {
  const accepted = await useAcceptedTask();
  await landAcceptedTask(accepted);
  withDataRootStore(accepted.dataRoot, (store) => moveTaskThrough(store, accepted.task.id, states));
  const before = eventsOf(accepted.dataRoot, KEY);

  const result = await runMarkLanded();

  expect(result).toEqual({ code: 0, out: `marked ${KEY} landed at ${accepted.revision}\n`, err: "" });
  expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
  const events = eventsOf(accepted.dataRoot, KEY);
  expect(events.slice(0, before.length)).toEqual(before);
  expect(events.slice(before.length)).toEqual([
    {
      type: "marked_landed",
      data: { revision: accepted.revision, baseTip: accepted.revision, from, to: "landed" },
    },
  ]);
  expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
  expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
};

describe("tasker mark-landed", () => {
  it("records a landing on the base and moves the task to landed", () => expectMarkedFrom([], "accepted"));

  it("records a landing for a task in pushed", () => expectMarkedFrom(["pushing", "pushed"], "pushed"));

  it("records a landing for a task in in_peer_review", () =>
    expectMarkedFrom(["pushing", "pushed", "opening_pr", "in_peer_review"], "in_peer_review"));

  it("reads the local tip of a base that is a local branch of the clone", async () => {
    const accepted = await useAcceptedTask();
    await runGit(["update-ref", "refs/heads/x", accepted.revision], { gitDir: accepted.clone, env: accepted.env });
    appendBaseEvent(accepted, "refs/heads/x", "refs/heads/x");
    const head = await accepted.origin.branchHead("main");

    const result = await runMarkLanded();

    expect(result.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)?.data).toMatchObject({ baseTip: accepted.revision });
    expect(await accepted.origin.branchHead("main")).toBe(head);
  });

  it("refuses work that is not on the base", async () => {
    const accepted = await useAcceptedTask();
    const head = await accepted.origin.addCommit("main");

    await expectRefused(
      accepted,
      `the branch ${String(accepted.task.branch)} (${accepted.revision}) is not on the base refs/remotes/origin/main (${head})\n`,
    );

    expect(await accepted.origin.branchHead("main")).toBe(head);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("accepted");
  });

  it("refuses when the fetch fails and writes no event", async () => {
    const accepted = await useAcceptedTask();
    renameSync(accepted.origin.path, `${accepted.origin.path}-moved`);

    await expectRefused(accepted, /^cannot read the base tip: /);
  });

  describe("refusals", () => {
    it("refuses a task in another state", async () => {
      const work = await useWorkReviewTask();

      await expectRefused(work, `the task of ${KEY} is in awaiting_work_review; tasker mark-landed needs ${NEEDS}\n`);
    });

    it("refuses a task with no branch", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture);

      await expectRefused(fixture, `the task of ${KEY} has no branch\n`);
    });

    it("refuses a task with no base", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture, { branch: "tasker/five" });

      await expectRefused(fixture, `the task of ${KEY} has no base\n`);
    });

    it("refuses a task with no base revision", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture, { branch: "tasker/five", base: "main" });

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
    const { code, help } = await runHelp(markLanded, "mark-landed");

    expect(code).toBe(0);
    expect(help).toContain(
      "Record that the work of a task in accepted, pushed or in_peer_review already landed on the base branch outside tasker: tasker fetches origin, the base must contain the task branch, and the task goes to landed. tasker never pushes",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
