import { statSync } from "node:fs";

// Node gives the same ENOENT for a missing folder and a missing program, and it throws for a folder that is a file.
// So a runner calls this before the spawn. It gives the error text when cwd is not a folder, else undefined.
export function startFolderError(file: string, cwd: string): string | undefined {
  if (statSync(cwd, { throwIfNoEntry: false })?.isDirectory() === true) return undefined;
  return `cannot start ${file}: the folder ${cwd} does not exist`;
}
