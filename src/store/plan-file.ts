import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { replaceFile } from "../replace-file.js";
import { planRevisionPath } from "./layout.js";
import {
  type NewPlanRevision,
  type PlanRevision,
  taskNotFound,
  type Task,
  type TaskStore,
} from "./store.js";

// Writes markdown as it is: no header and no added line end. replaceFile() needs the folder.
function writePlanFile(dataRoot: string, task: Task, version: number, markdown: string): void {
  const path = planRevisionPath(dataRoot, task, version);
  mkdirSync(dirname(path), { recursive: true });
  replaceFile(path, markdown);
}

// docs/dev/data-root.md gives the reasons for the order. The caller holds the task lock.
export function recordPlanRevision(
  store: TaskStore,
  dataRoot: string,
  taskId: number,
  revision: Omit<NewPlanRevision, "version">,
): PlanRevision {
  const task = store.getTask(taskId);
  if (task === undefined) throw taskNotFound(taskId);
  const version = store.nextPlanVersion(taskId);
  writePlanFile(dataRoot, task, version, revision.answer.plan_markdown);
  return store.insertPlanRevision(taskId, { ...revision, version });
}
