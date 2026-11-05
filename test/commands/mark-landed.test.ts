import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { markLanded } from "../../src/commands/mark-landed.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { readArgLog } from "../helpers/fake-commands.js";
import { useFakeClaudeOnPath } from "../helpers/fake-claude.js";
import { gitRecorderEnv } from "../helpers/git.js";
import { startLockHolder } from "../helpers/processes.js";
import {
  databasePathOf,
  eventsOf,
  latestTaskOf,
  readRunMarker,
  rejectMarkedLandedEvent,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import {
  useLocalBase,
  expectCommandRefused,
  landAcceptedTask,
  moveTaskThrough,
  seedAcceptedTask,
  useAcceptedTask,
  expectNoAssistantRun,
  useStartFixture,
  useWorkReviewTask,
  type StartFixture,
} from "../helpers/task-fixtures.js";
import { useProcessEnv } from "../helpers/temp.js";
import { wrongStateError } from "../helpers/state-commands.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const NEEDS = "accepted, pushed or in_peer_review";

const runMarkLanded = (issueKey = KEY) => runCommand(markLanded, "mark-landed", issueKey, "--repo", REPO);

// Runs mark-landed and expects a refusal that changes nothing.
const expectRefused = async (fixture: Pick<StartFixture, "dataRoot">, error: string | RegExp) => {
  const beforeTask = latestTaskOf(fixture.dataRoot, KEY);
  const beforeEvents = eventsOf(fixture.dataRoot, KEY);
  const beforeMarker = readRunMarker(databasePathOf(fixture.dataRoot), beforeTask.id);
  await expectCommandRefused({ dataRoot: fixture.dataRoot, key: KEY }, runMarkLanded, error);
  expect(latestTaskOf(fixture.dataRoot, KEY)).toEqual(beforeTask);
  expect(eventsOf(fixture.dataRoot, KEY)).toEqual(beforeEvents);
  expect(readRunMarker(databasePathOf(fixture.dataRoot), beforeTask.id)).toEqual(beforeMarker);
};

const expectSparseLanding = (
  dataRoot: string,
  taskId: number,
  before: ReturnType<typeof latestTaskOf>,
  events: ReturnType<typeof eventsOf>,
  marker: ReturnType<typeof readRunMarker>,
) => {
  const after = latestTaskOf(dataRoot, KEY);
  expect(after).toMatchObject({ ...before, state: "landed", updatedAt: expect.any(String) });
  expect(Object.hasOwn(after, "prNumber")).toBe(false);
  expect(eventsOf(dataRoot, KEY).slice(0, events.length)).toEqual(events);
  expect(eventsOf(dataRoot, KEY).slice(events.length)).toEqual([
    { type: "marked_landed", data: { from: "accepted", to: "landed" } },
  ]);
  expect(readRunMarker(databasePathOf(dataRoot), taskId)).toEqual(marker);
};

// Moves the task through states, declares it landed, and expects origin to keep the head of main.
// It also expects that no run marker stays.
const expectMarkedFrom = async (states: Parameters<typeof moveTaskThrough>[2], from: string) => {
  const accepted = await useAcceptedTask();
  withDataRootStore(accepted.dataRoot, (store) => moveTaskThrough(store, accepted.task.id, states));
  const head = await accepted.origin.branchHead("main");
  const recorder = gitRecorderEnv(accepted.origin.dir, process.env);
  useProcessEnv(recorder.env);
  const claude = useFakeClaudeOnPath({});
  const before = eventsOf(accepted.dataRoot, KEY);
  const gitCalls = readArgLog(recorder.log);
  const ghCalls = accepted.gh.calls();

  const result = await runMarkLanded();
  expect(readArgLog(recorder.log)).toEqual(gitCalls);
  expect(accepted.gh.calls()).toEqual(ghCalls);
  expectNoAssistantRun({ claude, started: { dataRoot: accepted.dataRoot } });

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
  expect(await accepted.origin.branchHead("main")).toBe(head);
  expect(readRunMarker(databasePathOf(accepted.dataRoot), accepted.task.id)).toBeUndefined();
};

describe("tasker mark-landed", () => {
  it("declares an accepted task landed", () => expectMarkedFrom([], "accepted"));

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

  it("marks a sparse accepted task with no branch", async () => {
    const fixture = await useStartFixture();
    const task = seedAcceptedTask(fixture);
    const before = latestTaskOf(fixture.dataRoot, KEY);
    expect(before.branch).toBeNull();
    expect(before.base).toBeNull();
    expect(before.worktreePath).toBeNull();
    expect(before.acceptedRevision).toBeNull();
    expect(before.publishedRevision).toBeNull();
    const events = eventsOf(fixture.dataRoot, KEY);
    const marker = readRunMarker(databasePathOf(fixture.dataRoot), task.id);

    const result = await runMarkLanded();
    expect(result).toEqual({ code: 0, out: `marked ${KEY} landed\n`, err: "" });
    expectSparseLanding(fixture.dataRoot, task.id, before, events, marker);
  });

  it("marks a sparse accepted task with no base", async () => {
    const fixture = await useStartFixture();
    const task = seedAcceptedTask(fixture, { branch: "tasker/five" });
    const before = latestTaskOf(fixture.dataRoot, KEY);
    expect(before.branch).toBe("tasker/five");
    expect(before.base).toBeNull();
    expect(before.worktreePath).toBeNull();
    expect(before.acceptedRevision).toBeNull();
    expect(before.publishedRevision).toBeNull();
    const events = eventsOf(fixture.dataRoot, KEY);
    const marker = readRunMarker(databasePathOf(fixture.dataRoot), task.id);

    const result = await runMarkLanded();
    expect(result).toEqual({ code: 0, out: `marked ${KEY} landed\n`, err: "" });
    expectSparseLanding(fixture.dataRoot, task.id, before, events, marker);
  });

  describe("refusals", () => {
    it("refuses a task in another state", async () => {
      const work = await useWorkReviewTask();

      await expectRefused(work, `${wrongStateError("awaiting_work_review", KEY, "mark-landed", NEEDS)}\n`);
    });

    it("refuses a live task in a spawning state without changing its marker", async () => {
      const fixture = await useStartFixture();
      const [task] = seedTasks(fixture.dataRoot, [
        { issueKey: KEY, repoKey: REPO, state: "pushing", at: "2026-01-01T00:00:00.000Z" },
      ]);
      const before = latestTaskOf(fixture.dataRoot, KEY);
      const events = eventsOf(fixture.dataRoot, KEY);
      const marker = readRunMarker(databasePathOf(fixture.dataRoot), task.id);
      const result = await runMarkLanded();
      expect(result.code).toBe(1);
      expect(result.err).toContain(wrongStateError("pushing", KEY, "mark-landed", NEEDS));
      expect(latestTaskOf(fixture.dataRoot, KEY)).toEqual(before);
      expect(eventsOf(fixture.dataRoot, KEY)).toEqual(events);
      expect(readRunMarker(databasePathOf(fixture.dataRoot), task.id)).toEqual(marker);
    });

    it("does not write when task lookup fails", async () => {
      const fixture = await useStartFixture({ issues: [{ project: REPO, number: 6 }] });
      const [task] = seedTasks(fixture.dataRoot, [
        { issueKey: "codeguru42/tasker#6", repoKey: REPO, state: "accepted", at: "2026-01-01T00:00:00.000Z" },
      ]);
      const before = latestTaskOf(fixture.dataRoot, "codeguru42/tasker#6");
      const events = eventsOf(fixture.dataRoot, "codeguru42/tasker#6");
      const marker = readRunMarker(databasePathOf(fixture.dataRoot), task.id);
      const result = await runMarkLanded("codeguru42/tasker#7");
      expect(result.code).toBe(1);
      expect(result.err).toContain("no task");
      expect(latestTaskOf(fixture.dataRoot, "codeguru42/tasker#6")).toEqual(before);
      expect(eventsOf(fixture.dataRoot, "codeguru42/tasker#6")).toEqual(events);
      expect(readRunMarker(databasePathOf(fixture.dataRoot), task.id)).toEqual(marker);
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
