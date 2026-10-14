import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { planRevisionPath, taskPlansDir } from "../../src/store/layout.js";
import { recordPlanRevision } from "../../src/store/plan-file.js";
import type { TaskStore } from "../../src/store/store.js";
import { thrownBy, useTempDir, validPlanAnswer, withDataRootStore } from "../helpers.js";

const newTask = { issueKey: "codeguru42/tasker#91", repoKey: "tasker", state: "planning" };

describe("recordPlanRevision", () => {
  let dataRoot: string;

  beforeEach(() => {
    dataRoot = useTempDir("tasker-plan-file-");
  });

  function record(store: TaskStore, taskId: number, markdown: string) {
    return recordPlanRevision(store, dataRoot, taskId, {
      source: "plan",
      answer: validPlanAnswer({ plan_markdown: markdown }),
      prompt: "plan@000000000000",
    });
  }

  it("makes the plans folder, writes the markdown as it is and then adds the row", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      const markdown = "## Summary\n\nno newline";

      const revision = record(store, task.id, markdown);

      expect(readFileSync(planRevisionPath(dataRoot, task, 1), "utf8")).toBe(markdown);
      expect(revision.version).toBe(1);
      expect(store.getPlanRevision(task.id, 1)).toEqual(revision);
    });
  });

  it("writes the next version in its own file and keeps the older file", () => {
    withDataRootStore(dataRoot, (store) => {
      const task = store.createTask(newTask);
      record(store, task.id, "first\n");

      record(store, task.id, "second\n");

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

      record(store, task.id, "new text\n");

      expect(readFileSync(path, "utf8")).toBe("new text\n");
      expect(store.getPlanRevision(task.id, 1)).toBeDefined();
    });
  });

  it("writes no file for a task that does not exist", () => {
    withDataRootStore(dataRoot, (store) => {
      const error = thrownBy(() => record(store, 9999, "text\n"));

      expect((error as Error).message).toBe("task not found: 9999");
      expect(existsSync(taskPlansDir(dataRoot, { issueKey: newTask.issueKey, attempt: 1 }))).toBe(false);
    });
  });
});
