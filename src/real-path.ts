import { lstatSync, realpathSync } from "node:fs";
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

// Resolves each existing path component and appends the missing parts. It throws for a dangling link or another error.
export function realPathWithMissingParents(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      return join(realpathSync.native(current), ...missing.reverse());
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      let stat;
      try {
        stat = lstatSync(current);
      } catch (statError) {
        if (errnoCode(statError) !== "ENOENT") throw statError;
      }
      if (stat?.isSymbolicLink()) throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.push(basename(current));
      current = parent;
    }
  }
}

// Matches a path against exact denials and entries that end in /**.
export function isDeniedPath(path: string, denied: readonly string[]): boolean {
  return denied.some((entry) => {
    if (!entry.endsWith("/**")) return path === entry;
    const base = entry.slice(0, -3);
    return path === base || isInside(path, base);
  });
}

// True when path is folder or inside it. It compares the paths as given, with no symlink resolution.
export function isInside(path: string, folder: string): boolean {
  const rel = relative(folder, path);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
