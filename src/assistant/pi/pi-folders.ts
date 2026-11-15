import { isAbsolute, resolve, join } from "node:path";
import { isInside, realPathWithMissingParents } from "../../real-path.js";
import { realPathFailureReason } from "./extensions.js";
import type { PiSandboxLimits } from "./guard-limits.js";

const WORKTREE = "the worktree";
const WRITE_PATH = "a path of sandbox.allowWrite";
const TEMP = "the temp folder of the start";

// Refuses when the worktree, an allowed write path or the temp folder of the start can write a folder of pi.
// The sandbox paths are the real paths of the same start.
export function piFolderRefusal(
  agentDir: string,
  home: string | undefined,
  sandbox: PiSandboxLimits,
): string | undefined {
  const candidates = [resolve(agentDir)];
  if (home !== undefined && isAbsolute(home)) candidates.push(join(home, ".pi"));

  const folders: string[] = [];
  for (const candidate of candidates) {
    let real: string;
    try {
      real = realPathWithMissingParents(candidate);
    } catch (error) {
      return realPathFailureReason(candidate, error);
    }
    if (!folders.includes(real)) folders.push(real);
  }

  const details: string[] = [];
  for (const folder of folders) {
    const kinds: string[] = [];
    if (isInside(sandbox.worktree, folder)) kinds.push(WORKTREE);
    if (sandbox.writePaths.some((path) => isInside(path, folder) || isInside(folder, path))) kinds.push(WRITE_PATH);
    if (isInside(sandbox.tempFolder, folder) || isInside(folder, sandbox.tempFolder)) kinds.push(TEMP);
    if (kinds.length > 0) details.push(`${folder} (${kinds.join(", ")})`);
  }
  if (details.length === 0) return undefined;
  return `a write path of the run overlaps a folder of pi: ${details.join(", ")}. Keep each write path of the run out of the folders of pi.`;
}
