import { accessSync, constants, statSync } from "node:fs";

// True when path names a file that exists, is a regular file and that the user can run. It never throws.
export function isRunnableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
