import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";
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

// The absolute path of a runnable program on PATH. Relative PATH entries use tasker's cwd.
export function findOnPath(program: string, env: NodeJS.ProcessEnv): string | undefined {
  for (const folder of (env.PATH ?? "").split(delimiter)) {
    if (folder === "") continue;
    const path = resolve(folder, program);
    if (isRunnableFile(path)) return path;
  }
  return undefined;
}

// True when a folder of env.PATH holds an executable file with this name.
export function isOnPath(program: string, env: NodeJS.ProcessEnv): boolean {
  return findOnPath(program, env) !== undefined;
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
