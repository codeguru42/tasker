import { writeFileSync } from "node:fs";
import { invalidDeniedCommandEntries } from "./denied-command-entry.js";
import type { RunInput } from "../provider.js";
import { guardLimitsPath } from "../../store/layout.js";

export interface GuardTool {
  name: string;
  path: string;
  source: string;
}

export interface PiSandboxLimits {
  bwrap: string;
  worktree: string;
  writePaths: string[];
  tempFolder: string;
  hidePaths: string[];
}

export interface GuardLimits {
  version: 1;
  cwd: string;
  tools: GuardTool[];
  readRoots: string[] | null;
  skillRoots: string[];
  protectedPaths: string[];
  denyRead: string[];
  writeRoots: string[];
  denyWrite: string[];
  deniedCommands: string[];
  sandbox: PiSandboxLimits | null;
}

export function builtInTool(name: string): GuardTool {
  return { name, path: `builtin:${name}`, source: "builtin" };
}

export function guardLimits(input: RunInput, tools: GuardTool[]): GuardLimits {
  if (input.access !== "read-only") {
    throw new Error("pi guard limits support read-only access only");
  }
  if (tools.some((tool) => tool.name === "bash")) {
    const invalid = invalidDeniedCommandEntries(input.deniedCommands);
    if (invalid.length > 0) {
      throw new Error(`invalid pi denied command entries: ${invalid.join(", ")}`);
    }
  }
  return {
    version: 1,
    cwd: input.cwd,
    tools,
    readRoots: null,
    skillRoots: [],
    protectedPaths: [],
    denyRead: [...(input.sandbox?.denyRead ?? [])],
    writeRoots: [],
    denyWrite: [],
    deniedCommands: [...input.deniedCommands],
    sandbox: null,
  };
}

export function writeGuardLimits(input: RunInput, limits: GuardLimits): string {
  const path = guardLimitsPath(input.sessionDir, input.sessionId);
  writeFileSync(path, JSON.stringify(limits), { mode: 0o600 });
  return path;
}
