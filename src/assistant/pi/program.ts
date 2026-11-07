import { resolveProgram } from "../../process/resolve-program.js";

export function piProgram(env: NodeJS.ProcessEnv): string {
  return resolveProgram("pi", "TASKER_PI_BIN", env);
}
