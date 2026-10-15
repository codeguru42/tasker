import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { showPlan } from "../../src/commands/show-plan.js";
import { transitionTask } from "../../src/state/machine.js";
import { planRevisionPath } from "../../src/store/layout.js";
import type { NewPlanRevision, Task } from "../../src/store/store.js";
import {
  dayAt,
  recordTestPlanRevision,
  runCommand,
  seedPlanRevision,
  seedTasks,
  useThreeRepoDataRoot,
  validPlanAnswer,
  withDataRootStore,
} from "../helpers.js";

const TASKER = "codeguru42/tasker";
const KEY = `${TASKER}#5`;

type Change = Partial<Omit<NewPlanRevision, "version">>;

// A task of the repo in the state planning, with the data root of the three-repo configuration.
function seedPlanningTask(): { dataRoot: string; task: Task } {
  const { dataRoot } = useThreeRepoDataRoot();
  const [task] = seedTasks(dataRoot, [{ issueKey: KEY, repoKey: TASKER, state: "planning", at: dayAt(2) }]);
  return { dataRoot, task };
}

// Records v1 with change1. With change2, moves the task to refining and records v2.
function recordRevisions(dataRoot: string, task: Task, change1: Change = {}, change2?: Change): void {
  withDataRootStore(dataRoot, (store) => {
    recordTestPlanRevision(store, dataRoot, task.id, change1);
    if (change2 !== undefined) {
      transitionTask(store, task.id, "refining");
      recordTestPlanRevision(store, dataRoot, task.id, change2);
    }
  });
}

const TODOS_AND_QUESTION =
  "todos:\n" +
  "  write-test: Add the a module\n" +
  "    Write the failing test of the a module.\n" +
  "    depends on: none\n" +
  "  make-it-pass: Add the a module\n" +
  "    Write the a module so that the test passes.\n" +
  "    depends on: write-test\n" +
  "questions:\n" +
  "  base-branch: Which branch is the base?\n" +
  "    The issue names no base branch.\n" +
  "    open\n";

const PLAN_V1 = "## Summary\n\nAdd the a module and its test, test first.\n";

describe("show-plan", () => {
  it("prints the header, the approval line, the plan, the todos and the questions", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task);

    const result = await runCommand(showPlan, "show-plan", KEY, "--repo", TASKER);

    expect(result).toEqual({
      code: 0,
      err: "",
      out: `${KEY} plan v1\nnot approved\n\n${PLAN_V1}${TODOS_AND_QUESTION}`,
    });
  });

  it("prints the newest revision by default", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task, {}, {
      source: "refine",
      feedback: "Use main.",
      answer: validPlanAnswer({ plan_markdown: "## Summary\n\nThe second plan of the a module.\n" }),
    });

    const result = await runCommand(showPlan, "show-plan", KEY);

    expect(result.code).toBe(0);
    expect(result.out.startsWith(`${KEY} plan v2\nnot approved\n\n## Summary\n\nThe second plan`)).toBe(true);
  });

  it("prints the revision of --version", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task, {}, {
      source: "refine",
      feedback: "Use main.",
      answer: validPlanAnswer({ plan_markdown: "## Summary\n\nThe second plan of the a module.\n" }),
    });

    const result = await runCommand(showPlan, "show-plan", KEY, "--version", "1");

    expect(result.code).toBe(0);
    expect(result.out.startsWith(`${KEY} plan v1\nnot approved\n\n${PLAN_V1}`)).toBe(true);
  });

  it("prints only the path of the plan file for --path", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task);

    const result = await runCommand(showPlan, "show-plan", KEY, "--path");

    expect(result).toEqual({ code: 0, err: "", out: `${planRevisionPath(dataRoot, task, 1)}\n` });
  });

  it("prints the path for --path also when the plan file is missing", async () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id));

    const result = await runCommand(showPlan, "show-plan", KEY, "--path");

    expect(result).toEqual({ code: 0, err: "", out: `${planRevisionPath(dataRoot, task, 1)}\n` });
  });

  describe("the approval line", () => {
    it("says not approved for a revision that nobody approved", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task);

      const result = await runCommand(showPlan, "show-plan", KEY);

      expect(result.out.split("\n")[1]).toBe("not approved");
    });

    it("says approved for the approved revision", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task);
      withDataRootStore(dataRoot, (store) => store.approvePlanRevision(task.id, 1, "approved"));

      const result = await runCommand(showPlan, "show-plan", KEY, "--version", "1");

      expect(result.out.split("\n")[1]).toBe("approved");
    });

    it("names the approved revision when another revision is shown", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task);
      withDataRootStore(dataRoot, (store) => {
        store.approvePlanRevision(task.id, 1, "approved");
        transitionTask(store, task.id, "awaiting_plan_review");
        transitionTask(store, task.id, "refining");
        recordTestPlanRevision(store, dataRoot, task.id, { source: "refine", feedback: "Use main." });
      });

      const result = await runCommand(showPlan, "show-plan", KEY);

      expect(result.out.split("\n").slice(0, 2)).toEqual([`${KEY} plan v2`, "approved revision is v1"]);
    });
  });

  describe("the questions", () => {
    const withoutQuestions = { answer: validPlanAnswer({ questions: [] }) };

    it("prints the answer of a question that a later revision answered", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task, {}, { source: "refine", feedback: "Use main.\nNot develop.", ...withoutQuestions });

      const result = await runCommand(showPlan, "show-plan", KEY, "--version", "1");

      expect(result.out.endsWith("    answered in v2: Use main.\n    Not develop.\n")).toBe(true);
    });

    it("prints no colon when the answering revision has no feedback", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task, {}, { source: "plan", ...withoutQuestions });

      const result = await runCommand(showPlan, "show-plan", KEY, "--version", "1");

      expect(result.out.endsWith("    answered in v2\n")).toBe(true);
    });

    it("prints none when the revision has no questions", async () => {
      const { dataRoot, task } = seedPlanningTask();
      recordRevisions(dataRoot, task, withoutQuestions);

      const result = await runCommand(showPlan, "show-plan", KEY);

      expect(result.out.endsWith("questions:\n  none\n")).toBe(true);
    });
  });

  it("keeps the indent on each line of a multi-line description and context", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task, {
      answer: validPlanAnswer({
        todos: [{ id: "one", title: "First\nsecond line", description: "Line a\nLine b", depends_on: [] }],
        questions: [{ id: "q", question: "Which?", context: "Context a\r\nContext b" }],
      }),
    });

    const result = await runCommand(showPlan, "show-plan", KEY);

    expect(result.out.endsWith(
      "todos:\n  one: First\n  second line\n    Line a\n    Line b\n    depends on: none\n" +
        "questions:\n  q: Which?\n    Context a\n    Context b\n    open\n",
    )).toBe(true);
  });

  it("puts todos on its own line when the plan text has no final line end", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task, {
      answer: validPlanAnswer({ plan_markdown: "## Summary\n\nno line end at the end" }),
    });

    const result = await runCommand(showPlan, "show-plan", KEY);

    expect(result.out).toContain("\n\n## Summary\n\nno line end at the end\ntodos:\n");
  });

  it.each(["0", "01", "-1", "1.5", "abc", "+1"])("rejects the bad --version value %s", async (value) => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task);

    const result = await runCommand(showPlan, "show-plan", KEY, "--version", value);

    expect(result).toEqual({ code: 1, out: "", err: `--version must be a whole number of 1 or more: ${value}\n` });
  });

  it("checks --version before the task lookup", async () => {
    const written = useThreeRepoDataRoot();
    const key = "nobody/else#1";

    const result = await runCommand(showPlan, "show-plan", key, "--version", "0");

    expect(result).toEqual({ code: 1, out: "", err: "--version must be a whole number of 1 or more: 0\n" });
    expect(existsSync(join(written.dataRoot, "tasker.db"))).toBe(false);
  });

  it("prints an error for a revision that does not exist", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task);

    const result = await runCommand(showPlan, "show-plan", KEY, "--version", "3");

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no plan revision v3\n` });
  });

  it("prints a very large version as the user typed it", async () => {
    const { dataRoot, task } = seedPlanningTask();
    recordRevisions(dataRoot, task);
    const big = `1${"0".repeat(29)}`;

    const result = await runCommand(showPlan, "show-plan", KEY, "--version", big);

    expect(result).toEqual({ code: 1, out: "", err: `the task of ${KEY} has no plan revision v${big}\n` });
  });

  it.each([[[]], [["--version", "2"]]])("prints an error for a task with no revision (%j)", async (extra) => {
    seedPlanningTask();

    const result = await runCommand(showPlan, "show-plan", KEY, ...extra);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `the task of ${KEY} has no plan revision; run tasker plan first\n`,
    });
  });

  it("prints an error when the plan file is missing", async () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id));

    const result = await runCommand(showPlan, "show-plan", KEY);

    expect(result).toEqual({ code: 1, out: "", err: `no plan file at ${planRevisionPath(dataRoot, task, 1)}\n` });
  });

  it("prints the error code when the plan file cannot be read", async () => {
    const { dataRoot, task } = seedPlanningTask();
    withDataRootStore(dataRoot, (store) => seedPlanRevision(store, task.id));
    const path = planRevisionPath(dataRoot, task, 1);
    mkdirSync(path, { recursive: true });

    const result = await runCommand(showPlan, "show-plan", KEY);

    expect(result).toEqual({ code: 1, out: "", err: `cannot read the plan file ${path}: EISDIR\n` });
  });

  it("prints an error for an issue with no task", async () => {
    useThreeRepoDataRoot();

    const result = await runCommand(showPlan, "show-plan", `${TASKER}#9`);

    expect(result).toEqual({
      code: 1,
      out: "",
      err: `no task for the issue ${TASKER}#9 in the repo ${TASKER}\n`,
    });
  });
});
