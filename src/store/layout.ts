import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathSlug } from "../issue-key/path-slug.js";
import type { Task } from "./store.js";

export interface DataRootLayout {
  root: string;
  clones: string;
  artifacts: string;
  database: string;
}

export function dataRootLayout(dataRoot: string): DataRootLayout {
  return {
    root: dataRoot,
    clones: join(dataRoot, "clones"),
    artifacts: join(dataRoot, "artifacts"),
    database: join(dataRoot, "tasker.db"),
  };
}

// Creates the folders that are missing. It does not create the database file.
export function createDataRoot(dataRoot: string): DataRootLayout {
  const layout = dataRootLayout(dataRoot);
  for (const path of [layout.root, layout.clones, layout.artifacts]) {
    mkdirSync(path, { recursive: true });
  }
  return layout;
}

// The folder of the files of one attempt. It makes no folder.
export function taskArtifactsDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(
    dataRootLayout(dataRoot).artifacts,
    pathSlug(task.issueKey),
    `attempt-${task.attempt}`,
  );
}

// The folder of the logs of one attempt. It makes no folder.
export function taskLogsDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(taskArtifactsDir(dataRoot, task), "logs");
}
