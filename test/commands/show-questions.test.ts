import { describe, expect, it } from "vitest";
import { showQuestions } from "../../src/commands/show-questions.js";
import { runCommand } from "../helpers/cli.js";
import { OPEN_QUESTION_BLOCK, recordPlanRevisions, seedPlanRevision, seedPlanningTask, validPlanAnswer } from "../helpers/plan.js";
import { withDataRootStore } from "../helpers/store.js";

const TASKER = "codeguru42/tasker";
const KEY = `${TASKER}#5`;

describe("show-questions", () => {
  it("prints the open questions of the newest revision", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(dataRoot, task);

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER);

    expect(result).toEqual({ code: 0, err: "", out: `${KEY} plan v1\n${OPEN_QUESTION_BLOCK}` });
  });

  it("prints the answered question of --version 1", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(
      dataRoot,
      task,
      {},
      { source: "refine", feedback: "Use main.", answer: validPlanAnswer({ questions: [] }) },
    );

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER, "--version", "1");

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} plan v1\nquestions:\n  base-branch: Which branch is the base?\n    The issue names no base branch.\n    answered in v2: Use main.\n`,
    });
  });

  it("prints one line when the revision has no questions", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(dataRoot, task, { answer: validPlanAnswer({ questions: [] }) });

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER);

    expect(result).toEqual({ code: 0, err: "", out: `${KEY} plan v1 has no questions\n` });
  });

  it("prints the questions of a revision with no plan file", async () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id));

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER);

    expect(result).toEqual({ code: 0, err: "", out: `${KEY} plan v1\n${OPEN_QUESTION_BLOCK}` });
  });

  it("rejects a bad --version value", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(dataRoot, task);

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER, "--version", "0");

    expect(result).toEqual({ code: 1, out: "", err: "--version must be a whole number of 1 or more: 0\n" });
  });

  it("prints an error for a revision that does not exist", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordPlanRevisions(dataRoot, task);

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER, "--version", "3");

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no plan revision v3\n` });
  });

  it("prints an error for a task with no revision", async () => {
    seedPlanningTask();

    const result = await runCommand(showQuestions, "show-questions", KEY, "--repo", TASKER);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} has no plan revision; run tasker plan first\n`,
    });
  });
});
