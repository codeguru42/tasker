import { describe, expect, it } from "vitest";
import { approveCredits } from "../../src/commands/approve-credits.js";
import { accept } from "../../src/commands/accept.js";
import { markLanded } from "../../src/commands/mark-landed.js";
import { execute } from "../../src/commands/execute.js";
import { merge } from "../../src/commands/merge.js";
import { refine } from "../../src/commands/refine.js";
import { resume } from "../../src/commands/resume.js";
import { retry } from "../../src/commands/retry.js";
import { review } from "../../src/commands/review.js";
import { updateBranch } from "../../src/commands/update-branch.js";
import { verify } from "../../src/commands/verify.js";
import { runCommand } from "../helpers/cli.js";
import { gitOutput } from "../helpers/git.js";
import { answerStream, turnResultStream, validPlanAnswer } from "../helpers/plan.js";
import { validReviewAnswer } from "../helpers/review.js";
import { failTaskFrom, latestTaskOf, pauseTaskFrom, placeTask, withDataRootStore } from "../helpers/store.js";
import {
  expectCommandRefused,
  expectNoAssistantRun,
  landAndDropParent,
  landParent,
  useStackedPlanTasks,
  useStackedTasks,
  type StackedPlanTasks,
  type StackedTasks,
} from "../helpers/task-fixtures.js";

const REPO = "codeguru42/tasker";
const PARENT = "codeguru42/tasker#5";
const STACKED = "codeguru42/tasker#6";

const NOT_LANDED = `the parent ${PARENT} of ${STACKED} has not landed; land the parent first, then run tasker update-branch ${STACKED}\n`;
const LANDED = `the parent ${PARENT} of ${STACKED} has landed; run tasker update-branch ${STACKED} to move the task onto main first\n`;
const CANCELLED = `the parent ${PARENT} of ${STACKED} is cancelled; ${STACKED} cannot land on it\n`;

const run = (command: typeof merge, name: string) => () => runCommand(command, name, STACKED, "--repo", REPO);

const LANDING_COMMANDS = [
  ["merge", merge],
  ["mark-landed", markLanded],
] as const;

describe.each(LANDING_COMMANDS)("tasker %s for a stacked task", (name, command) => {
  const runIt = run(command, name);

  // Expects a refusal that changes nothing and leaves main on origin where it was.
  async function expectRefused(fixture: StackedTasks, error: string): Promise<void> {
    const head = await fixture.origin.branchHead("main");
    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: STACKED }, runIt, error);
    expect(await fixture.origin.branchHead("main")).toBe(head);
  }

  it("refuses a stacked task while its parent is in flight", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));

    await expectRefused(fixture, NOT_LANDED);
  });

  it("refuses a stacked task with no own commit while its parent is in flight", async () => {
    const fixture = await useStackedTasks({ stackedCommit: false });
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));

    await expectRefused(fixture, NOT_LANDED);
  });

  it("refuses a stacked task after its parent landed", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "accepted"));
    await landAndDropParent(fixture);

    await expectRefused(fixture, LANDED);
  });

  it("refuses a stacked task whose parent is cancelled", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => {
      placeTask(store, fixture.stacked.task.id, "accepted");
      placeTask(store, fixture.parent.task.id, "cancelled");
    });

    await expectRefused(fixture, CANCELLED);
  });
});

describe("tasker merge after tasker update-branch", () => {
  it("lands a stacked task after update-branch moved it", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => placeTask(store, fixture.stacked.task.id, "awaiting_work_review"));
    const accepted = await runCommand(accept, "accept", STACKED, "--repo", REPO);
    expect(accepted.code).toBe(0);
    await landParent(fixture, ["accepted", "landed"]);

    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: STACKED }, run(merge, "merge"), LANDED);
    const moved = await runCommand(updateBranch, "update-branch", STACKED, "--repo", REPO);
    expect(moved.code).toBe(0);
    const result = await run(merge, "merge")();

    expect(result.code).toBe(0);
    const tip = await gitOutput({ cwd: fixture.stacked.worktree }, fixture.env, "rev-parse", "HEAD");
    expect(await fixture.origin.branchHead("main")).toBe(tip);
    expect(latestTaskOf(fixture.dataRoot, STACKED).state).toBe("landed");
  });
});

interface MovedBaseRow {
  name: string;
  // The state that the stacked task starts in. The plan of the task has v1 in every case.
  from: "awaiting_plan_review" | "approved" | "executed" | "awaiting_work_review";
  stream: string[];
  run: () => Promise<{ code: number; out: string; err: string }>;
  // The state of the task after a run that the guard lets through.
  after: string;
}

const MOVED_BASE_ROWS: MovedBaseRow[] = [
  {
    name: "accept",
    from: "awaiting_work_review",
    stream: [],
    run: () => runCommand(accept, "accept", STACKED, "--repo", REPO),
    after: "accepted",
  },
  {
    name: "review",
    from: "awaiting_work_review",
    stream: answerStream(validReviewAnswer()),
    run: () => runCommand(review, "review", STACKED, "--repo", REPO),
    after: "reviewed",
  },
  {
    name: "review with feedback",
    from: "awaiting_work_review",
    stream: answerStream(validPlanAnswer()),
    run: () => runCommand(review, "review", STACKED, "Change the plan.", "--repo", REPO),
    after: "awaiting_plan_review",
  },
  {
    name: "refine with feedback",
    from: "awaiting_plan_review",
    stream: answerStream(validPlanAnswer()),
    run: () => runCommand(refine, "refine", STACKED, "Change the plan.", "--repo", REPO),
    after: "awaiting_plan_review",
  },
  {
    name: "execute",
    from: "approved",
    stream: turnResultStream("done"),
    run: () => runCommand(execute, "execute", STACKED, "--repo", REPO),
    after: "executed",
  },
  {
    name: "verify",
    from: "executed",
    stream: [],
    run: () => runCommand(verify, "verify", STACKED, "--repo", REPO),
    after: "awaiting_work_review",
  },
];

// Gives the stacked task its plan, approves v1 for a state after the plan, and places the task in row.from.
async function stackedAt(row: MovedBaseRow): Promise<StackedPlanTasks> {
  const fixture = await useStackedPlanTasks(
    { stream: row.stream },
    { repo: { verify: { commands: ["true"], env: [] } } },
  );
  withDataRootStore(fixture.dataRoot, (store) => {
    if (row.from !== "awaiting_plan_review") store.approvePlanRevision(fixture.stacked.task.id, 1, "approved");
    if (row.from !== "awaiting_plan_review" && row.from !== "approved") {
      placeTask(store, fixture.stacked.task.id, row.from);
    }
  });
  return fixture;
}

describe.each(MOVED_BASE_ROWS)("tasker $name for a stacked task", (row) => {
  it("refuses a task whose parent landed", async () => {
    const fixture = await stackedAt(row);
    await landAndDropParent(fixture);

    await expectCommandRefused({ dataRoot: fixture.dataRoot, key: STACKED }, row.run, LANDED);

    expectNoAssistantRun({ claude: fixture.claude, started: fixture });
  });

  it("still runs while the parent is in flight", async () => {
    const fixture = await stackedAt(row);

    const result = await row.run();

    expect(result.code).toBe(0);
    expect(latestTaskOf(fixture.dataRoot, STACKED).state).toBe(row.after);
  });
});

describe("tasker accept for a stacked task whose parent is cancelled", () => {
  it("still accepts the task", async () => {
    const fixture = await useStackedTasks();
    withDataRootStore(fixture.dataRoot, (store) => {
      placeTask(store, fixture.stacked.task.id, "awaiting_work_review");
      placeTask(store, fixture.parent.task.id, "cancelled");
    });

    const result = await runCommand(accept, "accept", STACKED, "--repo", REPO);

    expect(result.code).toBe(0);
    expect(latestTaskOf(fixture.dataRoot, STACKED).state).toBe("accepted");
  });
});

describe("a command that moves the task and then runs the next command", () => {
  const cases = [
    {
      name: "retry",
      args: ["retry"],
      command: retry,
      out: `retried ${STACKED}: failed in executing, back in approved\n`,
      prepare: (store: Parameters<typeof failTaskFrom>[0], id: number) => failTaskFrom(store, id, "executing"),
    },
    {
      name: "resume",
      args: ["resume"],
      command: resume,
      out: `resumed ${STACKED}: paused in executing, back in approved\n`,
      prepare: (store: Parameters<typeof failTaskFrom>[0], id: number) =>
        pauseTaskFrom(store, id, "executing", "interrupted"),
    },
    {
      name: "approve-credits",
      args: ["approve-credits"],
      command: approveCredits,
      out: undefined,
      prepare: (store: Parameters<typeof failTaskFrom>[0], id: number) =>
        pauseTaskFrom(store, id, "executing", "awaiting_quota_approval"),
    },
  ];

  it.each(cases)("tasker $name leaves the task in approved when the guard refuses the next command", async (item) => {
    const fixture = await useStackedPlanTasks({ stream: turnResultStream("done") });
    withDataRootStore(fixture.dataRoot, (store) => {
      store.approvePlanRevision(fixture.stacked.task.id, 1, "approved");
      item.prepare(store, fixture.stacked.task.id);
    });
    await landAndDropParent(fixture);

    const result = await runCommand(item.command, item.args[0], STACKED, "--repo", REPO);

    expect(result.code).toBe(1);
    if (item.out !== undefined) expect(result.out).toBe(item.out);
    expect(result.err).toBe(LANDED);
    expect(latestTaskOf(fixture.dataRoot, STACKED).state).toBe("approved");
    expectNoAssistantRun({ claude: fixture.claude, started: fixture });
  });
});
