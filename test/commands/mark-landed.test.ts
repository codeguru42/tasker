import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markLanded } from "../../src/commands/mark-landed.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  rejectMarkedLandedEvent,
  withDataRootStore,
} from "../helpers/store.js";
import {
  useLocalBase,
  expectCommandRefused,
  landAcceptedTask,
  moveTaskThrough,
  seedAcceptedTask,
  useAcceptedTask,
  useStartFixture,
  useWorkReviewTask,
  type StartFixture,
} from "../helpers/task-fixtures.js";
import { wrongStateError } from "../helpers/state-commands.js";

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
  const ghCalls = accepted.gh.calls();

  const result = await runMarkLanded();

  expect(result).toEqual({ code: 0, out: `marked ${KEY} landed\n`, err: "" });
  expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
  const events = eventsOf(accepted.dataRoot, KEY);
  expect(events.slice(0, before.length)).toEqual(before);
  expect(events.slice(before.length)).toEqual([
    {
      type: "marked_landed",
      data: { from, to: "landed" },
    },
  ]);
  expect(accepted.gh.calls()).toEqual(ghCalls);
  expect(await accepted.origin.branchHead("main")).toBe(accepted.revision);
  expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
};

describe("tasker mark-landed", () => {
  it("records a landing on the base and moves the task to landed", () => expectMarkedFrom([], "accepted"));

  it("records a landing for a task in pushed", () => expectMarkedFrom(["pushing", "pushed"], "pushed"));

  it("records a landing for a task in in_peer_review", () =>
    expectMarkedFrom(["pushing", "pushed", "opening_pr", "in_peer_review"], "in_peer_review"));

  it("marks landed when the base is a local branch of the clone", async () => {
    const accepted = await useAcceptedTask();
    await useLocalBase(accepted, accepted.revision);
    const head = await accepted.origin.branchHead("main");

    const result = await runMarkLanded();

    expect(result.code).toBe(0);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
    expect(eventsOf(accepted.dataRoot, KEY).at(-1)?.data).toEqual({ from: "accepted", to: "landed" });
    expect(await accepted.origin.branchHead("main")).toBe(head);
  });

  it("declares work landed when the task branch is not on the base", async () => {
    const accepted = await useAcceptedTask();
    const head = await accepted.origin.addCommit("main");

    const result = await runMarkLanded();

    expect(result).toEqual({ code: 0, out: `marked ${KEY} landed\n`, err: "" });
    expect(await accepted.origin.branchHead("main")).toBe(head);
    expect(latestTaskOf(accepted.dataRoot, KEY).state).toBe("landed");
  });

  it("declares landed when the origin is missing", async () => {
    const accepted = await useAcceptedTask();
    renameSync(accepted.origin.path, `${accepted.origin.path}-moved`);

    const result = await runMarkLanded();
    expect(result).toEqual({ code: 0, out: `marked ${KEY} landed\n`, err: "" });
  });

  describe("refusals", () => {
    it("refuses a task in another state", async () => {
      const work = await useWorkReviewTask();

      await expectRefused(work, `${wrongStateError("awaiting_work_review", KEY, "mark-landed", NEEDS)}\n`);
    });

    it("marks a sparse accepted task with no branch", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture);

      expect((await runMarkLanded()).code).toBe(0);
    });

    it("marks a sparse accepted task with no base", async () => {
      const fixture = await useStartFixture();
      seedAcceptedTask(fixture, { branch: "tasker/five" });

      expect((await runMarkLanded()).code).toBe(0);
    });

    it("fails at once when another process holds the task lock", async () => {
      const accepted = await useAcceptedTask();
      const name = taskLockName(REPO, KEY);
      const holder = startLockHolder(databasePathOf(accepted.dataRoot), name);
      await holder.attempt;

      await expectRefused(accepted, new RegExp(`^the lock ${name} is busy`));
    });
  });

  it("leaves the task, events and run marker unchanged when the event insert fails", async () => {
    const accepted = await useAcceptedTask();
    await landAcceptedTask(accepted);
    const beforeTask = latestTaskOf(accepted.dataRoot, KEY);
    const beforeEvents = eventsOf(accepted.dataRoot, KEY);
    const dbPath = databasePathOf(accepted.dataRoot);
    const remove = rejectMarkedLandedEvent(dbPath);
    const result = await runMarkLanded();
    remove();

    expect(result.code).toBe(1);
    expect(result.err).toContain("event rejected");
    expect(latestTaskOf(accepted.dataRoot, KEY)).toEqual(beforeTask);
    expect(eventsOf(accepted.dataRoot, KEY)).toEqual(beforeEvents);
    expect(readRunMarker(dbPath, accepted.task.id)).toBeUndefined();
  });

  it("prints the description of the command and of --repo for --help", async () => {
    const { code, help } = await runHelp(markLanded, "mark-landed");

    expect(code).toBe(0);
    expect(help).toContain(
      "Declare that work in accepted, pushed or in_peer_review landed. This command makes no Git or forge calls",
    );
    expect(help).toContain("Use the repo with this key when two repos share the project of the issue");
  });
});
