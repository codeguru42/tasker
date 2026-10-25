import { type Stats, lstatSync, readlinkSync, realpathSync } from "node:fs";
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

// The real path of the deepest part of an absolute path that exists, plus the rest of the path. A
// symlink in the path is followed, also a dangling one, so the result is the path that a write
// through the path creates. Only a part that does not exist moves to the rest, and .. in the rest is
// resolved as text. It uses the native realpath, because the JS one resolves .. as text before it
// follows a symlink.
export function deepestRealPath(path: string): string {
  if (!isAbsolute(path)) throw new Error("the path is not absolute");
  let head = path;
  const rest: string[] = [];
  for (;;) {
    try {
      return join(realpathSync.native(head), ...rest);
    } catch (error) {
      if (errnoCode(error) !== "ENOENT") throw error;
      if (isDanglingSymlink(head)) {
        const target = readlinkSync(head);
        // Text, not join(): .. in the target must resolve against the real folder of the link.
        head = isAbsolute(target) ? target : `${realpathSync.native(dirname(head))}/${target}`;
        continue;
      }
      if (existsAsEntry(head) || dirname(head) === head) throw error;
      rest.unshift(basename(head));
      head = dirname(head);
    }
  }
}

function entryStats(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function isDanglingSymlink(path: string): boolean {
  return entryStats(path)?.isSymbolicLink() ?? false;
}

function existsAsEntry(path: string): boolean {
  return entryStats(path) !== undefined;
}
