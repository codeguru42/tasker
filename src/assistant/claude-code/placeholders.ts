import { lstatSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { errorMessage } from "../../error-message.js";
import type { SandboxCleanup } from "../provider.js";

// The placeholders that bwrap leaves, measured on claude 2.1.289 and 2.1.299. bwrap makes an empty
// read-only file for each protected path that does not exist. A killed claude leaves all of them.
// A normal exit still leaves .claude/.cc-writes and .claude.
const ROOT_FILES = [
  ".bash_profile",
  ".bashrc",
  ".gitconfig",
  ".gitmodules",
  ".idea",
  ".mcp.json",
  ".profile",
  ".ripgreprc",
  ".vscode",
  ".zprofile",
  ".zshrc",
];
const CLAUDE_ENTRIES = [
  "agents",
  "commands",
  "hooks",
  "skills",
  "workflows",
  "routines",
  "output-styles",
  "loop.md",
  "launch.json",
  "scheduled_tasks.json",
  "settings.json",
  "settings.local.json",
];
const CC_WRITES = ".claude/.cc-writes";
const CLAUDE_DIR = ".claude";

type Kind = "file" | "file-or-folder" | "folder";

function hasCode(error: unknown, codes: readonly string[]): boolean {
  return codes.includes((error as NodeJS.ErrnoException).code ?? "");
}

// ENOTDIR counts as missing too: a regular file in the place of a parent folder, such as a .claude file,
// or a .claude that changes after the parent check.
function statOrNothing(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (hasCode(error, ["ENOENT", "ENOTDIR"])) return undefined;
    throw error;
  }
}

// The cleanup follows no symlink, also not in a parent folder. The cwd is the worktree that tasker made.
// .claude is the only parent below it. Its entries count only when lstat shows it as a real folder, so a
// .claude symlink cannot lead the cleanup, or the trackedPaths question, to a folder outside the worktree.
function candidates(cwd: string): { path: string; kind: Kind }[] {
  const claudeIsFolder = statOrNothing(join(cwd, CLAUDE_DIR))?.isDirectory() === true;
  return [
    ...ROOT_FILES.map((path) => ({ path, kind: "file" as const })),
    ...(claudeIsFolder
      ? [
          ...CLAUDE_ENTRIES.map((entry) => ({ path: `${CLAUDE_DIR}/${entry}`, kind: "file-or-folder" as const })),
          { path: CC_WRITES, kind: "folder" as const },
        ]
      : []),
    { path: CLAUDE_DIR, kind: "folder" },
  ];
}

// Removes the placeholders in cwd. A tracked path stays, and so does anything that is not an empty
// read-only file with one link (or an empty folder). trackedPaths gets one call, with the candidates that exist.
// It never throws. An fs error gives the code only, because its message holds the path.
export async function removePlaceholders(
  cwd: string,
  trackedPaths: (paths: readonly string[]) => Promise<string[]>,
): Promise<SandboxCleanup> {
  try {
    const present = candidates(cwd).filter(({ path }) => statOrNothing(join(cwd, path)) !== undefined);
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
          if (hasCode(error, ["ENOENT", "ENOTDIR"])) continue;
          throw error;
        }
        removed.push(path);
      } else if (stat.isDirectory()) {
        if (kind === "file") continue;
        try {
          rmdirSync(full);
        } catch (error) {
          if (hasCode(error, ["ENOTEMPTY", "EEXIST", "ENOENT", "ENOTDIR"])) continue;
          throw error;
        }
        removed.push(path);
      }
    }
    return { removed: removed.sort() };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { error: typeof code === "string" ? `cannot remove the sandbox placeholders: ${code}` : errorMessage(error) };
  }
}
