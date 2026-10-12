import { lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { withoutLineEnd } from "./worktree.js";

// A lock file is stale when nobody has written it for this long.
const STALE_AFTER_MS = 60_000;

export class DeadlineError extends Error {}

export interface StaleLock {
  // The absolute real path of the lock file.
  path: string;
  ageMs: number;
}

// True when path is folder or inside it.
export function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder + sep);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// The lock files in the clone that are older than a minute, sorted by path.
// The scan follows no link and skips the folder objects directly under the clone.
// It throws a DeadlineError when Date.now() reaches deadline.
export function findStaleLocks(clone: string, nowMs: number, deadline: number): StaleLock[] {
  const root = realpathSync(clone);
  const found: StaleLock[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    for (const entry of entries) {
      if (Date.now() >= deadline) {
        throw new DeadlineError("the scan for lock files did not finish in time");
      }
      const path = join(folder, entry.name);
      if (entry.isDirectory()) {
        if (!(folder === root && entry.name === "objects")) {
          walk(path);
        }
      } else if (entry.isFile() && entry.name.endsWith(".lock")) {
        try {
          const ageMs = nowMs - lstatSync(path).mtimeMs;
          if (ageMs >= STALE_AFTER_MS) {
            found.push({ path, ageMs });
          }
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
    }
  };
  walk(root);
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export type ProcView =
  | { readable: true; openFiles: ReadonlySet<string>; gitCwds: readonly string[] }
  | { readable: false; reason: string };

// Reads the open files of every process, and the folder of every git process, from procRoot.
// A part of a process that gives an error (EACCES, ENOENT) is skipped.
export function readProcView(procRoot: string): ProcView {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    return { readable: false, reason: failure.code ?? failure.message };
  }
  const openFiles = new Set<string>();
  const gitCwds: string[] = [];
  const pids = names.filter((name) => /^\d+$/.test(name)).sort((a, b) => Number(a) - Number(b));
  for (const pid of pids) {
    const folder = join(procRoot, pid);
    try {
      for (const fd of readdirSync(join(folder, "fd"))) {
        try {
          openFiles.add(readlinkSync(join(folder, "fd", fd)));
        } catch {
          // The file closed, or the link is not readable. Skip it.
        }
      }
    } catch {
      // The process ended, or it belongs to another user. Skip its files.
    }
    try {
      const comm = withoutLineEnd(readFileSync(join(folder, "comm"), "utf8"));
      if (comm === "git" || comm.startsWith("git-")) {
        gitCwds.push(readlinkSync(join(folder, "cwd")));
      }
    } catch {
      // Skip the name or the folder of this process.
    }
  }
  return { readable: true, openFiles, gitCwds };
}

// A function that reads procRoot at the first call and gives the same view at each later call.
// On a platform that is not Linux, it gives undefined, and it reads nothing.
export function onceProcView(
  procRoot: string,
  platform: NodeJS.Platform,
): () => ProcView | undefined {
  if (platform !== "linux") {
    return () => undefined;
  }
  let view: ProcView | undefined;
  return () => {
    view ??= readProcView(procRoot);
    return view;
  };
}
