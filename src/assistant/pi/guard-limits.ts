import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isSet } from "../../config/path.js";
import { realPathWithMissingParents } from "../../real-path.js";
import { piSkillFolders } from "./skill-folders.js";
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

// Resolves the base of a denied write entry through links. A /** suffix stays.
export function realDeniedWriteEntry(entry: string): string {
  const glob = entry.endsWith("/**");
  const base = glob ? entry.slice(0, -3) || "/" : entry;
  const realBase = realPathWithMissingParents(base);
  return glob ? `${realBase.replace(/\/$/u, "")}/**` : realBase;
}

export function guardLimits(input: RunInput, tools: GuardTool[], agentDir: string): GuardLimits {
  const execute = input.access === "workspace-write";
  if (tools.some((tool) => tool.name === "bash")) {
    const invalid = invalidDeniedCommandEntries(input.deniedCommands);
    if (invalid.length > 0) {
      throw new Error(`invalid pi denied command entries: ${invalid.join(", ")}`);
    }
  }
  const denyRead = [...(input.sandbox?.denyRead ?? [])];
  if (!execute) {
    return {
      version: 1,
      cwd: input.cwd,
      tools,
      readRoots: null,
      skillRoots: [],
      protectedPaths: [],
      denyRead,
      writeRoots: [],
      denyWrite: [],
      deniedCommands: [...input.deniedCommands],
      sandbox: null,
    };
  }
  const home = input.env.HOME;
  const { agentFolder, homeFolder } = piSkillFolders(agentDir, home);
  return {
    version: 1,
    cwd: input.cwd,
    tools,
    readRoots: [input.cwd],
    skillRoots: [agentFolder, homeFolder].filter((folder): folder is string => folder !== undefined),
    protectedPaths: [
      ...(isSet(home) ? [home] : []),
      agentDir,
      join(agentDir, "auth.json"),
      join(agentDir, "settings.json"),
      join(agentDir, "sessions"),
      join(agentDir, "extensions"),
    ],
    denyRead,
    writeRoots: [input.cwd],
    denyWrite: input.deniedEditPaths.map(realDeniedWriteEntry),
    deniedCommands: [...input.deniedCommands],
    sandbox: null,
  };
}

export function writeGuardLimits(input: RunInput, limits: GuardLimits): string {
  const path = guardLimitsPath(input.sessionDir, input.sessionId);
  writeFileSync(path, JSON.stringify(limits), { mode: 0o600 });
  return path;
}
