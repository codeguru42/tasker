import { ALLOWED_ENV_NAMES } from "../config/allowed-env-names.js";

const DROPPED_NAMES: readonly string[] = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

// The environment of a phase: the allowed names, then the names that the repo lists, when env sets them.
export function phaseEnv(env: NodeJS.ProcessEnv, extraNames: readonly string[]): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of [...ALLOWED_ENV_NAMES, ...extraNames]) {
    if (env[name] === undefined || name.startsWith("TASKER_") || DROPPED_NAMES.includes(name)) continue;
    result[name] = env[name];
  }
  return result;
}
