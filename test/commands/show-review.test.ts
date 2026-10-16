import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showReview } from "../../src/commands/show-review.js";
import type { NewReview } from "../../src/store/store.js";
import { runCommand } from "../helpers/cli.js";
import { useThreeRepoDataRoot } from "../helpers/config.js";
import { findingText, reviewFinding } from "../helpers/review.js";
import { dayAt, seedReview, seedTasks, withDataRootStore } from "../helpers/store.js";

const TASKER = "codeguru42/tasker";
const KEY = `${TASKER}#5`;

const DEFAULT_FINDINGS = findingText("first", 1) + findingText("second", 2);

// Runs tasker show-review for key, with the repo of key as --repo, then the extra arguments.
function showReviewOf(key: string, ...extra: string[]) {
  return runCommand(showReview, "show-review", key, "--repo", key.split("#")[0], ...extra);
}

// A task of KEY with one review for each change. The task ends in state.
function seedReviews(changes: Partial<Omit<NewReview, "number">>[] = [], state?: string) {
  const { dataRoot } = useThreeRepoDataRoot();
  const [task] = seedTasks(dataRoot, [{ issueKey: KEY, repoKey: TASKER, state: "awaiting_work_review", at: dayAt(2) }]);
  withDataRootStore(dataRoot, (store) => changes.forEach((change) => seedReview(store, task.id, change, state)));
  return { dataRoot, task };
}

describe("show-review", () => {
  it("prints the newest review by default", async () => {
    seedReviews([
      { revision: "1111111aaaaa", endedAt: dayAt(2), findings: [reviewFinding()] },
      { revision: "2222222bbbbb", endedAt: dayAt(3) },
    ]);

    const result = await showReviewOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} review 2 of 2: 2 findings (at 2222222bbbbb, ${dayAt(3)})\n` + DEFAULT_FINDINGS,
    });
  });

  it("prints review 1 with --review 1", async () => {
    seedReviews([
      { revision: "1111111aaaaa", endedAt: dayAt(2), findings: [reviewFinding()] },
      { revision: "2222222bbbbb", endedAt: dayAt(3) },
    ]);

    const result = await showReviewOf(KEY, "--review", "1");

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} review 1 of 2: 1 finding (at 1111111aaaaa, ${dayAt(2)})\n` + findingText("first", 1),
    });
  });

  it("prints a review with no findings", async () => {
    seedReviews([{ findings: [] }]);

    const result = await showReviewOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} review 1 of 1: no findings (at 4b825dc642cb, ${dayAt(1)})\nno findings\n`,
    });
  });

  it("prints the status of a dismissed finding and counts it", async () => {
    const { dataRoot, task } = seedReviews([{}]);
    withDataRootStore(dataRoot, (store) =>
      store.dismissReviewFindings(task.id, 1, [2], "Not a bug.", "awaiting_work_review"),
    );

    const result = await showReviewOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out:
        `${KEY} review 1 of 1: 2 findings (at 4b825dc642cb, ${dayAt(1)})\n` +
        findingText("first", 1) +
        findingText("second", 2, "dismissed: Not a bug."),
    });
  });

  it("works in another state", async () => {
    seedReviews([{}], "accepted");

    const result = await showReviewOf(KEY);

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} review 1 of 1: 2 findings (at 4b825dc642cb, ${dayAt(1)})\n` + DEFAULT_FINDINGS,
    });
  });

  it.each(["0", "01", "-1", "1.5"])("fails for the bad --review value %s", async (value) => {
    seedReviews([{}]);

    const result = await showReviewOf(KEY, "--review", value);

    expect(result).toEqual({ code: 1, out: "", err: `--review must be a whole number of 1 or more: ${value}\n` });
  });

  it("checks --review before the task lookup", async () => {
    const written = useThreeRepoDataRoot();

    const result = await showReviewOf("nobody/else#1", "--review", "0");

    expect(result).toEqual({ code: 1, out: "", err: "--review must be a whole number of 1 or more: 0\n" });
    expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
  });

  it("fails for a review that does not exist", async () => {
    seedReviews([{}, {}]);

    const result = await showReviewOf(KEY, "--review", "3");

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no review 3; it has 2\n` });
  });

  it("prints a very large --review as the user typed it", async () => {
    seedReviews([{}]);
    const huge = "9".repeat(30);

    const result = await showReviewOf(KEY, "--review", huge);

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no review ${huge}; it has 1\n` });
  });

  it.each([[[]], [["--review", "2"]]])("fails for a task with no review, with the arguments %j", async (extra) => {
    seedReviews();

    const result = await showReviewOf(KEY, ...extra);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} has no review; run tasker review first\n`,
    });
  });

  it("fails for an issue with no task", async () => {
    seedReviews();

    const result = await showReviewOf("codeguru42/other#9");

    expect(result).toEqual({
      code: 1,
      out: "",
      err: "no task for the issue codeguru42/other#9 in the repo codeguru42/other\n",
    });
  });
});
