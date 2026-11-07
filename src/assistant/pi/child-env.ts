import { piAgentDir } from "../config-folders.js";
import { isSet, relativePathReason } from "../../config/path.js";
import { childEnv } from "../../process/child-env.js";

export function relativeHomeReason(env: NodeJS.ProcessEnv): string | undefined {
  return isSet(env.TASKER_PI_CODING_AGENT_DIR) ? undefined : relativePathReason("HOME", env.HOME);
}

export function piChildEnv(
  env: NodeJS.ProcessEnv,
): { env: NodeJS.ProcessEnv & { PI_CODING_AGENT_DIR: string } } | { reason: string } {
  const relativeReason = relativePathReason("TASKER_PI_CODING_AGENT_DIR", env.TASKER_PI_CODING_AGENT_DIR);
  if (relativeReason !== undefined) return { reason: relativeReason };

  const relativeHome = relativeHomeReason(env);
  if (relativeHome !== undefined) return { reason: relativeHome };

  const agentDir = piAgentDir(env);
  if (agentDir === undefined) {
    return { reason: "tasker cannot find the agent folder of pi, because HOME is not set" };
  }

  return { env: { ...childEnv(env, []), PI_CODING_AGENT_DIR: agentDir } };
}
