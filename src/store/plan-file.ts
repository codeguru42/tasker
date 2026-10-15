import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { errorMessage } from "../error-message.js";
import { transitionWithPlanRevision, type TaskState } from "../state/machine.js";
import { replaceFile } from "../replace-file.js";
import { planRevisionPath } from "./layout.js";
import {
  type NewPlanRevision,
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

// The write of a plan file failed. The message is the error that tasker records for the task.
export class PlanFileWriteError extends Error {
  constructor(version: number, cause: unknown) {
    super(`cannot write the plan file of revision v${version}: ${errorMessage(cause)}`, { cause });
    this.name = "PlanFileWriteError";
  }
}

// docs/dev/data-root.md gives the reasons for the order. The caller holds the task lock and gives the version.
export function recordPlanRevision(
  store: TaskStore,
  dataRoot: string,
  taskId: number,
  revision: NewPlanRevision,
  to: TaskState,
): Task {
  const task = store.getTask(taskId);
  if (task === undefined) throw taskNotFound(taskId);
  try {
    writePlanFile(dataRoot, task, revision.version, revision.answer.plan_markdown);
  } catch (error) {
    throw new PlanFileWriteError(revision.version, error);
  }
  return transitionWithPlanRevision(store, taskId, to, revision);
}
