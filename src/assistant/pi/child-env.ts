import { isAbsolute, resolve } from "node:path";
import { piAgentDir } from "../config-folders.js";
import { relativePathReason } from "../../config/path.js";
import { childEnv } from "../../process/child-env.js";

export function piChildEnv(env: NodeJS.ProcessEnv): { env: NodeJS.ProcessEnv } | { reason: string } {
  const relativeReason = relativePathReason("TASKER_PI_CODING_AGENT_DIR", env.TASKER_PI_CODING_AGENT_DIR);
  if (relativeReason !== undefined) return { reason: relativeReason };

  const agentDir = piAgentDir(env);
  if (agentDir === undefined) {
    return { reason: "tasker cannot find the agent folder of pi, because HOME is not set" };
  }

  const resolvedAgentDir = isAbsolute(agentDir) ? agentDir : resolve(agentDir);
  const result = childEnv(env, []);
  result.PI_CODING_AGENT_DIR = resolvedAgentDir;
  return { env: result };
}
