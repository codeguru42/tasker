import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { planRevisionPath, taskPlansDir } from "../../src/store/layout.js";
import { PlanFileWriteError } from "../../src/store/plan-file.js";
import { transitionTask } from "../../src/state/machine.js";
import { recordTestPlanRevision, thrownBy, useTempDir, validPlanAnswer, withDataRootStore } from "../helpers.js";

const newTask = { issueKey: "codeguru42/tasker#91", repoKey: "tasker", state: "planning" };

describe("recordPlanRevision", () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = useTempDir("tasker-plan-file-");
  });

  it("makes the plans folder, writes the markdown as it is and then adds the row", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      const markdown = "## Summary\n\nno newline";

      const revision = recordTestPlanRevision(store, dataRoot, task.id, {
        answer: validPlanAnswer({ plan_markdown: markdown }),
      });

      expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
      expect(revision.state).toBe("awaiting_plan_review");
      expect(store.getTask(task.id)).toEqual(revision);
      expect(store.getPlanRevision(task.id, 1)?.answer.plan_markdown).toBe(markdown);
    });
  });

  it("writes the next version in its own file and keeps the older file", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      recordTestPlanRevision(store, dataRoot, task.id, { answer: validPlanAnswer({ plan_markdown: "first\n" }) });
      transitionTask(store, task.id, "refining");

      recordTestPlanRevision(store, dataRoot, task.id, { answer: validPlanAnswer({ plan_markdown: "second\n" }) });

      expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe("first\n");
      expect(readFileSync(planRevisionPath(dataRoot, task, 2), "utf8")).toBe("second\n");
      expect(store.latestPlanRevision(task.id)?.version).toBe(2);
    });
  });

  it("replaces a file that has no row", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      const path = planRevisionPath(dataRoot, task, 1);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "left by a stopped run");

      recordTestPlanRevision(store, dataRoot, task.id, { answer: validPlanAnswer({ plan_markdown: "new text\n" }) });

      expect(readFileSync(path, "utf8")).toBe("new text\n");
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
    });
  });

  it("throws a clear error and inserts no row when the plan file cannot be written", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      const plansDir = taskPlansDir(dataRoot, task);
      mkdirSync(dirname(plansDir), { recursive: true });
      writeFileSync(plansDir, "a file, not a folder");

      const error = thrownBy(() => recordTestPlanRevision(store, dataRoot, task.id, { answer: validPlanAnswer({ plan_markdown: "text\n" }) }));

      expect(error).toBeInstanceOf(PlanFileWriteError);
      expect((error as Error).message).toMatch(/^cannot write the plan file of revision v1: /);
      expect(store.getPlanRevision(task.id, 1)).toBeUndefined();
      expect(store.getTask(task.id)?.state).toBe("planning");
    });
  });

  it("writes no file for a task that does not exist", () => {
    withDataRootStore(dataRoot, (store) => {
      const error = thrownBy(() => recordTestPlanRevision(store, dataRoot, 9999, { answer: validPlanAnswer({ plan_markdown: "text\n" }) }));

      expect((error as Error).message).toBe("task not found: 9999");
      expect(existsSync(taskPlansDir(dataRoot, { issueKey: newTask.issueKey, attempt: 1 }))).toBe(false);
    });
  });
});
