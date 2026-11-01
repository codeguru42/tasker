import { lstatSync } from "node:fs";
import { join } from "node:path";
import { hasErrnoCode } from "../../errno.js";
import type { PlaceholderList } from "../placeholders.js";

// The folders that the sandbox of a write run makes as empty mount points in the worktree, measured on
// codex-cli 0.166.0. A read-only run leaves none.
const FOLDERS = [".agents", ".aws", ".codex"];

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (hasErrnoCode(error, ["ENOENT", "ENOTDIR"])) return false;
    throw error;
  }
}

// The list for the cleanup of a write run. Call it before the spawn. A name that exists then is not a
// placeholder of the run, so the list leaves it out. A link counts as existing.
export function absentPlaceholders(cwd: string): PlaceholderList {
  return { rootFiles: [], rootFolders: FOLDERS.filter((name) => !exists(join(cwd, name))) };
}
