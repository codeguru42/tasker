import { lstatSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { errnoCode, hasErrnoCode } from "../errno.js";
import { errorMessage } from "../error-message.js";
import type { SandboxCleanup } from "./provider.js";

export type PlaceholderKind = "file" | "file-or-folder" | "folder";

// The names that a provider's sandbox can leave in the worktree. The rootFiles are files at the root.
// The folder is one folder at the root, with its entries. The entries count only when lstat shows a real folder.
export interface PlaceholderList {
  rootFiles: readonly string[];
  // Folders at the root. Each one is removed only when it is an empty folder.
  rootFolders?: readonly string[];
  folder?: { name: string; entries: readonly { name: string; kind: PlaceholderKind }[] };
}

// ENOTDIR counts as missing too: a regular file in the place of a parent folder, such as a .claude file,
// or a .claude that changes after the parent check.
function statOrNothing(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (hasErrnoCode(error, ["ENOENT", "ENOTDIR"])) return undefined;
    throw error;
  }
}

// The cleanup follows no symlink, also not in a parent folder. The cwd is the worktree that tasker made.
// The folder is the only parent below it. Its entries count only when lstat shows it as a real folder, so a
// symlink cannot lead the cleanup, or the trackedPaths question, to a folder outside the worktree.
function candidates(cwd: string, list: PlaceholderList): { path: string; kind: PlaceholderKind }[] {
  const { folder } = list;
  const folderIsReal = folder !== undefined && statOrNothing(join(cwd, folder.name))?.isDirectory() === true;
  return [
    ...list.rootFiles.map((path) => ({ path, kind: "file" as const })),
    ...(list.rootFolders ?? []).map((path) => ({ path, kind: "folder" as const })),
    ...(folder !== undefined && folderIsReal
      ? folder.entries.map((entry) => ({ path: `${folder.name}/${entry.name}`, kind: entry.kind }))
      : []),
    ...(folder !== undefined ? [{ path: folder.name, kind: "folder" as const }] : []),
  ];
}

// Removes the placeholders of the list in cwd. A tracked path stays, and so does anything that is not an empty
// read-only file with one link (or an empty folder). trackedPaths gets one call, with the candidates that exist.
// It never throws. An fs error gives the code only, because its message holds the path.
export async function removePlaceholders(
  cwd: string,
  list: PlaceholderList,
  trackedPaths: (paths: readonly string[]) => Promise<string[]>,
): Promise<SandboxCleanup> {
  try {
    const present = candidates(cwd, list).filter(({ path }) => statOrNothing(join(cwd, path)) !== undefined);
    if (present.length === 0) return { removed: [] };
    const tracked = new Set(await trackedPaths(present.map(({ path }) => path)));
    const removed: string[] = [];
    for (const { path, kind } of present) {
      if (tracked.has(path)) continue;
      const full = join(cwd, path);
      const stat = statOrNothing(full);
      if (stat === undefined || stat.isSymbolicLink()) continue;
      if (stat.isFile()) {
        if (kind === "folder") continue;
        if (stat.size !== 0 || (stat.mode & 0o222) !== 0 || stat.nlink !== 1) continue;
        try {
          rmSync(full);
        } catch (error) {
          if (hasErrnoCode(error, ["ENOENT", "ENOTDIR"])) continue;
          throw error;
        }
        removed.push(path);
      } else if (stat.isDirectory()) {
        if (kind === "file") continue;
        try {
          rmdirSync(full);
        } catch (error) {
          if (hasErrnoCode(error, ["ENOTEMPTY", "EEXIST", "ENOENT", "ENOTDIR"])) continue;
          throw error;
        }
        removed.push(path);
      }
    }
    return { removed: removed.sort() };
  } catch (error) {
    const code = errnoCode(error);
    return { error: code !== undefined ? `cannot remove the sandbox placeholders: ${code}` : errorMessage(error) };
  }
}
