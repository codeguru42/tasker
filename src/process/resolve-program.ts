import { accessSync, constants, statSync } from "node:fs";
import { resolve } from "node:path";
import { isSet } from "../config/path.js";

// True when path names a file that exists, is a regular file and that the user can run. It never throws.
export function isRunnableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// The variable names a file that does not exist, a folder, or a file that the user cannot run.
export class ProgramFileError extends Error {
  readonly variable: string;
  readonly value: string;

  constructor(variable: string, value: string) {
    super(`${variable} is ${value}, but ${value} is not a file that you can run`);
    this.name = "ProgramFileError";
    this.variable = variable;
    this.value = value;
  }
}

// The program to start for name. It reads only env, never process.env.
// - An unset variable gives name.
// - A value with no "/" gives the value. runChild() finds it on the PATH of env.
// - A value with a "/" must name a file that the user can run. A relative value resolves against the cwd.
//   The function gives the absolute path, or throws ProgramFileError.
export function resolveProgram(name: string, variable: string, env: NodeJS.ProcessEnv): string {
  const value = env[variable];
  if (!isSet(value)) return name;
  if (!value.includes("/")) return value;
  const path = resolve(value);
  if (!isRunnableFile(path)) throw new ProgramFileError(variable, value);
  return path;
}
