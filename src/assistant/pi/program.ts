import { resolveProgram } from "../../process/resolve-program.js";

export function piNotInstalled(program: string): string {
  return `${program} is not installed or not on PATH`;
}

export function piProgram(env: NodeJS.ProcessEnv): string {
  return resolveProgram("pi", "TASKER_PI_BIN", env);
}
