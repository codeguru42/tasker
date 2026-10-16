import { describe, expect, it } from "vitest";
import { dismissReview } from "../../src/commands/dismiss-review.js";
import { taskLockName } from "../../src/store/locks.js";
import { runCommand } from "../helpers/cli.js";
import { useConfigFile, useThreeRepoDataRoot } from "../helpers/config.js";
import { startLockHolder } from "../helpers/processes.js";
import { reviewFinding } from "../helpers/review.js";
import {
  databasePathOf,
  dayAt,
  eventsOf,
  latestTaskOf,
  lockNames,
  seedTaskWithReviews,
  seedTasks,
  withDataRootStore,
} from "../helpers/store.js";
import { expectCommandRefused } from "../helpers/task-fixtures.js";

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const REASON = "Not a bug.";
const FINDING_ERROR = "--finding must be a list of whole numbers of 1 or more, separated by commas: ";
const NO_OPEN_LINE = "no open findings; the task is in awaiting_work_review\n";

const runDismiss = (...args: string[]) => runCommand(dismissReview, "dismiss-review", KEY, ...args, "--repo", REPO);

const THREE_FINDINGS = {
  findings: [
    reviewFinding(),
    reviewFinding({ file: "src/b.ts", line: 9 }),
    reviewFinding({ file: "src/c.ts", line: 4, summary: "The name is wrong." }),
  ],
};

function seedReviewed(reviews: Parameters<typeof seedTaskWithReviews>[2] = [{}]) {
  const { dataRoot } = useThreeRepoDataRoot();
  const task = seedTaskWithReviews(
    dataRoot,
    { issueKey: KEY, repoKey: REPO, state: "awaiting_work_review", at: dayAt(2) },
    reviews,
  );
  return { dataRoot, task };
}

// The dismissed field of each finding of each review, oldest review first.
function dismissalsOf(dataRoot: string, taskId: number) {
  return withDataRootStore(dataRoot, (store) =>
    store.listReviews(taskId).map((review) => review.findings.map((entry) => entry.dismissed)),
  );
}

async function expectRefusedWithoutWrite(
  target: { dataRoot: string; taskId: number },
  args: string[],
  error: string | RegExp,
) {
  const before = dismissalsOf(target.dataRoot, target.taskId);
  await expectCommandRefused({ dataRoot: target.dataRoot, key: KEY }, () => runDismiss(...args), error);
  expect(dismissalsOf(target.dataRoot, target.taskId)).toEqual(before);
}

describe("dismiss-review", () => {
  it("dismisses all open findings and moves the task", async () => {
    const { dataRoot } = seedReviewed();
    const before = eventsOf(dataRoot, KEY);

    const result = await runDismiss(REASON);

    expect(result).toEqual({
      code: 0,
      out: `dismissed findings 1, 2 of review 1 of ${KEY}\n${NO_OPEN_LINE}`,
      err: "",
    });
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
    expect(eventsOf(dataRoot, KEY)).toEqual([
      ...before,
      { type: "review_dismissed", data: { number: 1, positions: [1, 2], reason: REASON } },
      { type: "transition", data: { from: "reviewed", to: "awaiting_work_review" } },
    ]);
  });

  it("dismisses some findings and keeps the task in reviewed", async () => {
    const { dataRoot } = seedReviewed([THREE_FINDINGS]);

    const result = await runDismiss(REASON, "--finding", "3,1");

    expect(result).toEqual({
      code: 0,
      out: `dismissed findings 1, 3 of review 1 of ${KEY}\nopen findings: 2\n`,
      err: "",
    });
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");
    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual({
      type: "review_dismissed",
      data: { number: 1, positions: [1, 3], reason: REASON },
    });
  });

  it("allows spaces around the items of --finding", async () => {
    const { dataRoot } = seedReviewed([THREE_FINDINGS]);

    const result = await runDismiss(REASON, "--finding", " 1 , 3 ");

    expect(result.out).toBe(`dismissed findings 1, 3 of review 1 of ${KEY}\nopen findings: 2\n`);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");
  });

  it("stores the reason as the user typed it", async () => {
    const { dataRoot } = seedReviewed();

    await runDismiss("  padded  ", "--finding", "1");

    expect(eventsOf(dataRoot, KEY).at(-1)).toEqual({
      type: "review_dismissed",
      data: { number: 1, positions: [1], reason: "  padded  " },
    });
  });

  it("moves the task when the last open finding is dismissed after a partial dismissal", async () => {
    const { dataRoot } = seedReviewed();

    const first = await runDismiss(REASON, "--finding", "1");
    expect(first.out).toBe(`dismissed findings 1 of review 1 of ${KEY}\nopen findings: 2\n`);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");

    const second = await runDismiss(REASON, "--finding", "2");
    expect(second.out).toBe(`dismissed findings 2 of review 1 of ${KEY}\n${NO_OPEN_LINE}`);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it("dismisses only the open findings when it runs again without --finding", async () => {
    const { dataRoot } = seedReviewed([THREE_FINDINGS]);
    await runDismiss("First.", "--finding", "2");

    const result = await runDismiss(REASON);

    expect(result.out).toBe(`dismissed findings 1, 3 of review 1 of ${KEY}\n${NO_OPEN_LINE}`);
    expect(latestTaskOf(dataRoot, KEY).state).toBe("awaiting_work_review");
  });

  it("counts only the latest review", async () => {
    const { dataRoot, task } = seedReviewed([{}, {}]);

    const result = await runDismiss(REASON);

    expect(result.out).toBe(`dismissed findings 1, 2 of review 2 of ${KEY}\n${NO_OPEN_LINE}`);
    const [older, latest] = dismissalsOf(dataRoot, task.id);
    expect(older).toEqual([null, null]);
    expect(latest.every((dismissed) => dismissed !== null)).toBe(true);
  });
});

describe("a refused --finding", () => {
  it.each(["0", "01", "1,,2", "a", "-1", "1.5", ""])("refuses the value %j", async (value) => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", value],
      `${FINDING_ERROR}${value}\n`,
    );
  });

  it("refuses a repeated position", async () => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "1,1"],
      "--finding names 1 more than once\n",
    );
  });

  it("reads the option before the configuration", async () => {
    useConfigFile(() => "not json");

    const result = await runDismiss(REASON, "--finding", "0");

    expect(result).toEqual({ code: 1, out: "", err: `${FINDING_ERROR}0\n` });
  });
});

describe("a refused dismiss-review", () => {
  it("refuses a position that the review does not have", async () => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "3"],
      `the latest review of ${KEY} has no finding 3; it has 2\n`,
    );
  });

  it("refuses a position that is already dismissed", async () => {
    const { dataRoot, task } = seedReviewed();
    await runDismiss("First.", "--finding", "1");

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "1,2"],
      `finding 1 of ${KEY} is already dismissed: First.\n`,
    );
    expect(dismissalsOf(dataRoot, task.id)[0][1]).toBeNull();
  });

  it("reports each bad position on its own line, in order", async () => {
    const { dataRoot, task } = seedReviewed();
    await runDismiss("First.", "--finding", "1");

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "1,5"],
      `finding 1 of ${KEY} is already dismissed: First.\nthe latest review of ${KEY} has no finding 5; it has 2\n`,
    );
  });

  it("does not take two large positions with the same rounded value for a repeat", async () => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "9007199254740993,9007199254740992"],
      `the latest review of ${KEY} has no finding 9007199254740993; it has 2\nthe latest review of ${KEY} has no finding 9007199254740992; it has 2\n`,
    );
  });

  it("prints a very large position as the user typed it", async () => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON, "--finding", "99999999999999999999"],
      `the latest review of ${KEY} has no finding 99999999999999999999; it has 2\n`,
    );
  });

  it.each(["", "   "])("refuses the empty reason %j", async (reason) => {
    const { dataRoot, task } = seedReviewed();

    await expectRefusedWithoutWrite({ dataRoot, taskId: task.id }, [reason], "the reason is empty\n");
  });

  it("refuses a task in another state", async () => {
    const { dataRoot, task } = seedReviewed([]);

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON],
      `the task of ${KEY} is in awaiting_work_review; tasker dismiss-review needs reviewed\n`,
    );
  });

  it("refuses a task in reviewed with no review", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const [task] = seedTasks(dataRoot, [{ issueKey: KEY, repoKey: REPO, state: "reviewed", at: dayAt(2) }]);

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON],
      `the task of ${KEY} is in reviewed and has no review\n`,
    );
  });

  it("refuses a review with no open finding", async () => {
    const { dataRoot, task } = seedReviewed();
    withDataRootStore(dataRoot, (store) => store.dismissReviewFindings(task.id, 1, [1, 2], "x", "reviewed"));
    expect(latestTaskOf(dataRoot, KEY).state).toBe("reviewed");

    await expectRefusedWithoutWrite(
      { dataRoot, taskId: task.id },
      [REASON],
      `the latest review of ${KEY} has no open finding\n`,
    );
  });

  it("fails at once when another process holds the task lock", async () => {
    const { dataRoot, task } = seedReviewed();
    const name = taskLockName(REPO, KEY);
    const holder = startLockHolder(databasePathOf(dataRoot), name);
    await holder.attempt;

    await expectRefusedWithoutWrite({ dataRoot, taskId: task.id }, [REASON], new RegExp(`^the lock ${name} is busy`));

    expect(lockNames(dataRoot)).toEqual([name]);
  });
});
