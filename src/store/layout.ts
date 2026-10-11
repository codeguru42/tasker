import { mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DataRootLayout {
  root: string;
  clones: string;
  worktrees: string;
  artifacts: string;
  database: string;
}

export function dataRootLayout(dataRoot: string): DataRootLayout {
  return {
    root: dataRoot,
    clones: join(dataRoot, "clones"),
    worktrees: join(dataRoot, "worktrees"),
    artifacts: join(dataRoot, "artifacts"),
    database: join(dataRoot, "tasker.db"),
  };
}

// Creates the folders that are missing. It does not create the database file.
export function createDataRoot(dataRoot: string): DataRootLayout {
  const layout = dataRootLayout(dataRoot);
  for (const path of [layout.root, layout.clones, layout.worktrees, layout.artifacts]) {
    mkdirSync(path, { recursive: true });
  }
  return layout;
}
