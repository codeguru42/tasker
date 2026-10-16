import { homedir as osHomedir } from "node:os";
import { join } from "node:path";

// The one home of the "is set" rule of an env value: undefined and a blank string count as unset.
export function isSet(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== "";
}

export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env, homedir: string = osHomedir()): string {
  if (isSet(env.TASKER_CONFIG)) return env.TASKER_CONFIG;
  if (isSet(env.XDG_CONFIG_HOME)) return join(env.XDG_CONFIG_HOME, "tasker", "config.json");
  return join(homedir, ".config", "tasker", "config.json");
}
