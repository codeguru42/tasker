import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// The path as git lists it: the real parent folder, then the last part. It works for a missing
// folder, because git lists the real path of the parent.
export function canonicalPath(path: string): string {
  const full = resolve(path);
  try {
    return join(realpathSync(dirname(full)), basename(full));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return full;
    throw error;
  }
}
