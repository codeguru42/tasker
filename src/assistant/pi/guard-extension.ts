import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errnoCode } from "../../errno.js";
import { isDeniedPath, isInside, realPathWithMissingParents } from "../../real-path.js";
import type { GuardLimits, GuardTool } from "./guard-limits.js";
import { invalidDeniedCommandEntries } from "./denied-command-entry.js";
import { checkBashCommand } from "./bash-command-check.js";

const LIMITS_FLAG = "--tasker-guard-limits";
const LIMITS_FIELD_NAMES = [
  "version",
  "cwd",
  "tools",
  "readRoots",
  "skillRoots",
  "protectedPaths",
  "denyRead",
  "writeRoots",
  "denyWrite",
  "deniedCommands",
] as const;
const FILE_TOOLS = {
  read: { field: "path", noPath: "Not permitted", kind: "read" },
  grep: { field: "path", noPath: "The worktree (.)", kind: "read" },
  find: { field: "path", noPath: "The worktree (.)", kind: "read" },
  ls: { field: "path", noPath: "The worktree (.)", kind: "read" },
  edit: { field: "path", noPath: "Not permitted", kind: "write" },
  write: { field: "path", noPath: "Not permitted", kind: "write" },
} as const;
const UNICODE_SPACES = new Set(
  [
    0x00a0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f,
    0x3000,
  ].map((codePoint) => String.fromCodePoint(codePoint)),
);
const NARROW_NO_BREAK_SPACE = String.fromCodePoint(0x202f);
const RIGHT_SINGLE_QUOTE = String.fromCodePoint(0x2019);

interface PiApi {
  registerFlag(name: string, options: PiFlagOptions): void;
  getAllTools(): PiTool[];
  on(event: "tool_call" | "before_agent_start", handler: (event: unknown, context: PiContext) => unknown): void;
}

type PiFlagOptions = { description: string; type: "string" } | { description: string; type: "boolean" };

interface PiTool {
  name: string;
  sourceInfo: { path: string; source: string };
}

interface PiContext {
  cwd?: unknown;
  [key: string]: unknown;
}

export default function guardExtension(pi: PiApi): void {
  pi.registerFlag("tasker-guard-limits", {
    description: "Path to the limits file for the tasker pi guard",
    type: "string",
  });
  const state: { limits: GuardLimits | undefined; eventSkillRoots: string[] } = {
    limits: undefined,
    eventSkillRoots: [],
  };
  pi.on("tool_call", (event, context) => {
    try {
      if (state.limits === undefined) return blocked("the guard has no validated limits");
      return checkToolCall(event, context, pi, state.limits, state.eventSkillRoots);
    } catch {
      return blocked("the pi guard failure blocked the tool call");
    }
  });
  pi.on("before_agent_start", (event) => {
    try {
      if (state.limits === undefined) return undefined;
      const roots = skillFolders(event);
      state.eventSkillRoots = skillRootsWithoutDeniedPaths(roots, state.limits.protectedPaths, state.limits.denyRead);
    } catch {
      state.eventSkillRoots = [];
    }
    return undefined;
  });

  const path = limitsFileArg(process.argv);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new Error("tasker could not read the pi guard limits");
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error("tasker could not parse the pi guard limits");
  }
  state.limits = validateLimits(value);
}

function checkToolCall(
  event: unknown,
  context: PiContext,
  pi: PiApi,
  limits: GuardLimits,
  eventSkillRoots: readonly string[],
): { block: true; reason: string } | undefined {
  if (!isRecord(event) || typeof event.toolName !== "string" || event.toolName.length === 0) {
    return blocked("the guard cannot check a tool call with no tool name");
  }

  const current = pi.getAllTools().find((tool) => tool.name === event.toolName);
  const configured = limits.tools.find((tool) => tool.name === event.toolName);
  if (configured === undefined) return blocked("the tool is missing from the guard limits");
  if (current === undefined) return blocked("the tool is no longer available");
  if (current.sourceInfo.path !== configured.path || current.sourceInfo.source !== configured.source) {
    return blocked("the tool source does not match the guard limits");
  }
  if (event.toolName === "bash") {
    const input = isRecord(event.input) ? event.input : {};
    if (typeof input.command !== "string") {
      return blocked(
        "tasker blocked this command: the guard extension cannot read it with certainty (the command is not a string).",
      );
    }
    const result = checkBashCommand(input.command, limits.deniedCommands);
    return result.block ? blocked(result.reason) : undefined;
  }
  if (event.toolName === "powershell") {
    return blocked("the guard has no command test for shell tools");
  }
  const fileRule = Object.hasOwn(FILE_TOOLS, event.toolName)
    ? FILE_TOOLS[event.toolName as keyof typeof FILE_TOOLS]
    : undefined;
  if (fileRule === undefined) return undefined;
  return checkFileCall(event, context, limits, eventSkillRoots, fileRule);
}

interface ResolvedPath {
  supplied: string;
  real: string;
}

function checkFileCall(
  event: Record<string, unknown>,
  context: PiContext,
  limits: GuardLimits,
  eventSkillRoots: readonly string[],
  rule: (typeof FILE_TOOLS)[keyof typeof FILE_TOOLS],
): { block: true; reason: string } | undefined {
  // 1. Require a path unless grep, find or ls uses the worktree by default.
  const input = isRecord(event.input) ? event.input : {};
  const rawPath = input[rule.field];
  let path: string;
  if (rawPath === undefined && rule.noPath === "The worktree (.)") path = ".";
  else if (typeof rawPath === "string") path = rawPath;
  else return blocked("the file tool needs a string path");

  // 2. Reject spaces that pi changes to plain spaces.
  if (Array.from(path).some((character) => UNICODE_SPACES.has(character))) {
    return blocked("the file path contains a Unicode space");
  }

  // 3. The tool context and limits must name the same real worktree.
  if (typeof context.cwd !== "string") return blocked("the tool has no valid worktree path");
  let realCwd: string;
  let realLimitsCwd: string;
  try {
    realCwd = realPathWithMissingParents(context.cwd);
    realLimitsCwd = realPathWithMissingParents(limits.cwd);
  } catch (error) {
    return pathResolutionBlock(error);
  }
  if (realCwd !== realLimitsCwd) return blocked("the tool worktree does not match the guard limits");

  // 4. Apply pi path forms, then make the path absolute from the tool worktree.
  let resolved: string;
  try {
    let normalized = path.startsWith("@") ? path.slice(1) : path;
    if (normalized === "~") normalized = homedir();
    else if (normalized.startsWith("~/")) normalized = join(homedir(), normalized.slice(2));
    if (normalized.startsWith("file://")) normalized = fileURLToPath(normalized);
    resolved = resolve(context.cwd, normalized);
  } catch {
    return blocked("the file path form is invalid");
  }

  // 5. A missing read tries the forms below as well as the path itself.
  const suppliedCandidates = [resolved];
  if (event.toolName === "read" && !existsSync(resolved)) {
    const narrow = resolved.replace(
      / (AM|PM)\./giu,
      (_match, meridiem: string) => `${NARROW_NO_BREAK_SPACE}${meridiem}.`,
    );
    const nfd = resolved.normalize("NFD");
    const apostrophe = resolved.replace(/'/gu, RIGHT_SINGLE_QUOTE);
    const nfdApostrophe = nfd.replace(/'/gu, RIGHT_SINGLE_QUOTE);
    for (const candidate of [narrow, nfd, apostrophe, nfdApostrophe]) {
      if (!suppliedCandidates.includes(candidate)) suppliedCandidates.push(candidate);
    }
  }

  // 6. Resolve every path component, including links in the middle of a path.
  const candidates: ResolvedPath[] = [];
  try {
    for (const supplied of suppliedCandidates) {
      candidates.push({ supplied, real: realPathWithMissingParents(supplied) });
    }
  } catch (error) {
    return pathResolutionBlock(error);
  }

  const denyReadEntries = [...limits.denyRead, "/proc"];
  // 7. Read denials apply to reads and writes before their roots.
  let readDenials: { entries: ResolvedPath[]; denied: boolean };
  try {
    readDenials = checkReadDenials(candidates, denyReadEntries);
  } catch (error) {
    return pathResolutionBlock(error);
  }
  if (readDenials.denied) return blocked("the file path is denied");

  if (rule.kind === "read") {
    // 8. grep and find traverse the search tree. ls does not.
    if (
      (event.toolName === "grep" || event.toolName === "find") &&
      candidates.some((candidate) => readDenials.entries.some((entry) => isInside(entry.real, candidate.real)))
    ) {
      return blocked("the search path contains a denied entry");
    }

    // 9. A read root grants access only when it exists and contains the real candidate.
    if (limits.readRoots !== null) {
      let allowedRoots: string[];
      try {
        const skillRoots = skillRootsWithoutDeniedPaths(
          [...limits.skillRoots, ...eventSkillRoots],
          limits.protectedPaths,
          limits.denyRead,
        );
        allowedRoots = existingRealRoots([...limits.readRoots, ...skillRoots]);
      } catch (error) {
        return pathResolutionBlock(error);
      }
      if (candidates.some((candidate) => !allowedRoots.some((root) => isInside(candidate.real, root)))) {
        return blocked("the file path is outside the read roots");
      }
    }
  } else {
    // 10. Writes also obey read denials. They then obey write denials and roots.
    let denied: ResolvedPath[];
    try {
      denied = limits.denyWrite.map((supplied) => {
        const glob = supplied.endsWith("/**");
        const base = glob ? supplied.slice(0, -3) || "/" : supplied;
        const realBase = realPathWithMissingParents(base);
        return { supplied, real: glob ? `${realBase.replace(/\/$/u, "")}/**` : realBase };
      });
    } catch (error) {
      return pathResolutionBlock(error);
    }
    if (
      candidates.some((candidate) =>
        denied.some((entry) =>
          [candidate.supplied, candidate.real].some((candidatePath) =>
            [entry.supplied, entry.real].some((entryPath) => isDeniedPath(candidatePath, [entryPath])),
          ),
        ),
      )
    ) {
      return blocked("the file path is denied for writes");
    }
    let allowedRoots: string[];
    try {
      allowedRoots = existingRealRoots(limits.writeRoots);
    } catch (error) {
      return pathResolutionBlock(error);
    }
    if (candidates.some((candidate) => !allowedRoots.some((root) => isInside(candidate.real, root)))) {
      return blocked("the file path is outside the write roots");
    }
  }
  return undefined;
}

function checkReadDenials(
  candidates: readonly ResolvedPath[],
  suppliedEntries: readonly string[],
): { entries: ResolvedPath[]; denied: boolean } {
  const entries = suppliedEntries.map((supplied) => ({ supplied, real: realPathWithMissingParents(supplied) }));
  const denied = candidates.some((candidate) =>
    entries.some((entry) =>
      [candidate.supplied, candidate.real].some((candidatePath) =>
        [entry.supplied, entry.real].some((entryPath) => isInside(candidatePath, entryPath)),
      ),
    ),
  );
  return { entries, denied };
}

function existingRealRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => {
    try {
      statSync(root);
      return [realPathWithMissingParents(root)];
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return [];
      throw error;
    }
  });
}

function skillFolders(event: unknown): string[] {
  if (!isRecord(event) || !isRecord(event.systemPromptOptions)) return [];
  const skills = event.systemPromptOptions.skills;
  if (skills === undefined) return [];
  if (!Array.isArray(skills)) throw new Error("invalid skill folders");
  return skills.map((skill) => {
    if (!isRecord(skill) || typeof skill.filePath !== "string" || !isAbsolute(skill.filePath)) {
      throw new Error("invalid skill folder");
    }
    return dirname(skill.filePath);
  });
}

function skillRootsWithoutDeniedPaths(
  roots: readonly string[],
  protectedPaths: readonly string[],
  denyRead: readonly string[],
): string[] {
  const entries = [...protectedPaths, ...denyRead, "/proc"];
  const resolvedEntries = entries.map((supplied) => ({ supplied, real: realPathWithMissingParents(supplied) }));
  const allowed: string[] = [];

  for (const supplied of roots) {
    let real: string;
    try {
      statSync(supplied);
      real = realPathWithMissingParents(supplied);
    } catch (error) {
      if (errnoCode(error) === "ENOENT") continue;
      throw error;
    }
    const rootPaths = [supplied, real];
    const overlapsDenied = resolvedEntries.some((entry) => {
      const entryPaths = [entry.supplied, entry.real];
      return rootPaths.some((rootPath) =>
        entryPaths.some((entryPath) => isInside(rootPath, entryPath) || isInside(entryPath, rootPath)),
      );
    });
    if (!overlapsDenied) allowed.push(supplied);
  }
  return allowed;
}

function pathResolutionBlock(error: unknown): { block: true; reason: string } {
  return blocked(`the file path could not be resolved (${errnoCode(error) ?? "unknown error"})`);
}

function blocked(reason: string): { block: true; reason: string } {
  return { block: true, reason };
}

function limitsFileArg(args: readonly string[]): string {
  const positions = args.flatMap((arg, index) => (arg === LIMITS_FLAG ? [index] : []));
  if (positions.length !== 1) throw new Error(`tasker needs exactly one ${LIMITS_FLAG} flag`);

  const path = args[positions[0] + 1];
  if (path === undefined || !isAbsolute(path)) {
    throw new Error(`tasker needs an absolute path after ${LIMITS_FLAG}`);
  }
  return path;
}

function validateLimits(value: unknown): GuardLimits {
  const invalid = new Set<string>();
  const record = isRecord(value) ? value : undefined;

  if (record === undefined) {
    for (const name of LIMITS_FIELD_NAMES) invalid.add(name);
  } else {
    if (record.version !== 1) invalid.add("version");
    if (!isAbsolutePath(record.cwd)) invalid.add("cwd");
    if (!validTools(record.tools)) invalid.add("tools");
    if (record.readRoots !== null && !absolutePathList(record.readRoots)) invalid.add("readRoots");
    if (!absolutePathList(record.skillRoots)) invalid.add("skillRoots");
    if (!absolutePathList(record.protectedPaths)) invalid.add("protectedPaths");
    if (!absolutePathList(record.denyRead)) invalid.add("denyRead");
    if (!absolutePathList(record.writeRoots)) invalid.add("writeRoots");
    if (!denyWriteList(record.denyWrite)) invalid.add("denyWrite");
    if (!nonEmptyStringList(record.deniedCommands)) {
      invalid.add("deniedCommands");
    } else if (
      validTools(record.tools) &&
      record.tools.some((tool) => tool.name === "bash") &&
      invalidDeniedCommandEntries(record.deniedCommands).length > 0
    ) {
      invalid.add("deniedCommands");
    }
    for (const name of LIMITS_FIELD_NAMES) {
      if (!Object.hasOwn(record, name)) invalid.add(name);
    }
  }

  if (invalid.size > 0) {
    const names = LIMITS_FIELD_NAMES.filter((name) => invalid.has(name));
    throw new Error(`invalid pi guard limits fields: ${names.join(", ")}`);
  }
  return value as GuardLimits;
}

function validTools(value: unknown): value is GuardTool[] {
  if (!Array.isArray(value)) return false;
  const names = new Set<string>();
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return false;
    if (typeof item.name !== "string" || item.name.length === 0) return false;
    const path = item.path;
    if (typeof path !== "string") return false;
    const toolPath: string = path;
    if (!(isAbsolutePath(toolPath) || /^builtin:.+/u.test(toolPath))) return false;
    if (typeof item.source !== "string" || item.source.length === 0) return false;
    if (names.has(item.name)) return false;
    names.add(item.name);
  }
  return true;
}

function absolutePathList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isAbsolutePath);
}

function denyWriteList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (typeof entry !== "string") return false;
      const path = entry.endsWith("/**") ? entry.slice(0, -3) : entry;
      return isAbsolutePath(path);
    })
  );
}

function nonEmptyStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry.length > 0);
}

function isAbsolutePath(value: unknown): value is string {
  return typeof value === "string" && isAbsolute(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
