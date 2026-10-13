import { join } from "node:path";
import { bootstrapLogPath } from "../phases/bootstrap.js";
import { taskArtifactsDir } from "../store/layout.js";
import type { Task } from "../store/store.js";

// The path of the bootstrap log of the attempt of task.
export function taskBootstrapLogPath(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">): string {
  return bootstrapLogPath(join(taskArtifactsDir(dataRoot, task), "logs"));
}
