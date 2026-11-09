import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { type PlaceholderList, statOrNothing } from "../placeholders.js";

// The folders that the sandbox of a write run makes as empty mount points in the worktree, measured on
// codex-cli 0.166.0. A read-only run leaves none.
const FOLDERS = [".agents", ".aws", ".codex"];

// The list for the cleanup of a write run. Call it before the spawn. A name that exists then is not a
// placeholder of the run, so the list leaves it out. A link counts as existing.
export function absentPlaceholders(cwd: string): PlaceholderList {
  return { rootFiles: [], rootFolders: FOLDERS.filter((name) => statOrNothing(join(cwd, name)) === undefined) };
}

// Creates the roots that the write sandbox denies. The Codex sandbox needs each deny target to exist when it starts.
// The returned list lets the provider remove only roots that were absent before this run and are still empty.
export function prepareWritePlaceholders(cwd: string): PlaceholderList {
  const placeholders = absentPlaceholders(cwd);
  const missing = placeholders.rootFolders ?? [];
  for (const name of FOLDERS) {
    const stat = statOrNothing(join(cwd, name));
    if (stat !== undefined && (!stat.isDirectory() || stat.isSymbolicLink())) {
      throw new Error(`the protected Codex path ${join(cwd, name)} is not a real folder`);
    }
  }
  const created: string[] = [];
  try {
    for (const name of missing) {
      mkdirSync(join(cwd, name));
      created.push(name);
    }
  } catch (error) {
    for (const name of created.reverse()) {
      try {
        const path = join(cwd, name);
        const stat = statOrNothing(path);
        if (stat?.isDirectory() && !stat.isSymbolicLink()) rmdirSync(path);
      } catch {
        // Keep the original creation error.
      }
    }
    throw error;
  }
  return placeholders;
}
