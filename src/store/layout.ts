import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathSlug } from "../issue-key/path-slug.js";
import type { Task } from "./store.js";

export interface DataRootLayout {
  root: string;
  clones: string;
  artifacts: string;
  prompts: string;
  database: string;
}

export function dataRootLayout(dataRoot: string): DataRootLayout {
  return {
    root: dataRoot,
    clones: join(dataRoot, "clones"),
    artifacts: join(dataRoot, "artifacts"),
    prompts: join(dataRoot, "prompts"),
    database: join(dataRoot, "tasker.db"),
  };
}

// Creates the folders that are missing. It does not create the database file.
export function createDataRoot(dataRoot: string): DataRootLayout {
  const layout = dataRootLayout(dataRoot);
  for (const path of [layout.root, layout.clones, layout.artifacts, layout.prompts]) {
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

// The folder of the assistant sessions of one attempt. It makes no folder.
export function taskSessionsDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(taskArtifactsDir(dataRoot, task), "sessions");
}

// The folder of the logs of one attempt. It makes no folder.
export function taskLogsDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(taskArtifactsDir(dataRoot, task), "logs");
}

// The folder of the logs of one verify run. It makes no folder.
export function verifyRunDir(dataRoot: string, task: Pick<Task, "issueKey" | "attempt">, run: number): string {
  return join(taskLogsDir(dataRoot, task), `verify-run-${run}`);
}

// The log of the command at position (from 1) of one verify run. Each reader and writer takes the path from here. It makes no file.
export function verifyCommandLogPath(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
  run: number,
  position: number,
): string {
  return join(verifyRunDir(dataRoot, task, run), `verify-${position}.log`);
}

// The folder of the plan files of one attempt. It makes no folder.
export function taskPlansDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(taskArtifactsDir(dataRoot, task), "plans");
}

// The plan file of one revision. Each reader takes the path from here. It makes no file.
export function planRevisionPath(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
  version: number,
): string {
  return join(taskPlansDir(dataRoot, task), `v${version}.md`);
}

// The folder of the transcripts of one attempt. It makes no folder.
export function taskTranscriptsDir(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
): string {
  return join(taskArtifactsDir(dataRoot, task), "transcripts");
}

// The transcript of the planning run of one plan version: one JSON event on each line, opened for
// append. Each writer takes the path from here. It makes no file.
export function planTranscriptPath(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
  version: number,
): string {
  return join(taskTranscriptsDir(dataRoot, task), `plan-v${version}.jsonl`);
}

// The transcript of the execute runs of one plan version: one JSON event on each line, opened for append, so the
// runs of one revision share one history. Each writer takes the path from here. It makes no file.
export function executeTranscriptPath(
  dataRoot: string,
  task: Pick<Task, "issueKey" | "attempt">,
  version: number,
): string {
  return join(taskTranscriptsDir(dataRoot, task), `execute-v${version}.jsonl`);
}

// The path of the file that tasker doctor writes and deletes in dataRoot. The name is new for
// each call, so two doctors that run at the same time do not use the same file. It makes no file.
export function doctorProbePath(dataRoot: string): string {
  return join(dataRoot, `.doctor-probe-${process.pid}-${randomUUID()}`);
}
