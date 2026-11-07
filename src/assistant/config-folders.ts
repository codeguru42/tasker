import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isSet } from "../config/path.js";

// The configuration folder of claude: CLAUDE_CONFIG_DIR, else .claude under HOME, else none.
export function claudeConfigDir(env: NodeJS.ProcessEnv): string | undefined {
  if (isSet(env.CLAUDE_CONFIG_DIR)) return env.CLAUDE_CONFIG_DIR;
  return isSet(env.HOME) ? join(env.HOME, ".claude") : undefined;
}

// The home folder of Codex: CODEX_HOME, else .codex under HOME, else none.
export function codexHome(env: NodeJS.ProcessEnv): string | undefined {
  if (isSet(env.CODEX_HOME)) return env.CODEX_HOME;
  return isSet(env.HOME) ? join(env.HOME, ".codex") : undefined;
}

// The agent folder of pi: TASKER_PI_CODING_AGENT_DIR, else .pi/agent under HOME, else none.
export function piAgentDir(env: NodeJS.ProcessEnv): string | undefined {
  if (isSet(env.TASKER_PI_CODING_AGENT_DIR)) {
    const value = env.TASKER_PI_CODING_AGENT_DIR;
    if (value === "~") return isSet(env.HOME) ? env.HOME : undefined;
    if (value.startsWith("~/")) return isSet(env.HOME) ? join(env.HOME, value.slice(2)) : undefined;
    if (value.startsWith("file://")) {
      try {
        return fileURLToPath(value);
      } catch {
        return value;
      }
    }
    return value;
  }
  return isSet(env.HOME) ? join(env.HOME, ".pi", "agent") : undefined;
}
