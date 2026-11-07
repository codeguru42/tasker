import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { GuardLimits, GuardTool } from "./guard-limits.js";

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

interface PiApi {
  registerFlag(name: string, description: string): void;
}

export default function guardExtension(pi: PiApi): void {
  pi.registerFlag("tasker-guard-limits", "Path to the limits file for the tasker pi guard");

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
  validateLimits(value);
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
    if (!nonEmptyStringList(record.deniedCommands)) invalid.add("deniedCommands");
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
