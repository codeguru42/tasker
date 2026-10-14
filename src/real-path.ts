import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { errnoCode } from "./errno.js";

// The path as git lists it: the real parent folder, then the last part. It works for a missing
// folder, because git lists the real path of the parent.
export function canonicalPath(path: string): string {
  const full = resolve(path);
  try {
    return join(realpathSync(dirname(full)), basename(full));
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return full;
    throw error;
  }
}

// True when path is folder or inside it. It compares the paths as given, with no symlink resolution.
export function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
