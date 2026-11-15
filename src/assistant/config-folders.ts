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
    return parsePiAgentValue(env.TASKER_PI_CODING_AGENT_DIR, env);
  }
  return isSet(env.HOME) ? join(env.HOME, ".pi", "agent") : undefined;
}

// The agent folders of pi: TASKER_PI_CODING_AGENT_DIR, PI_CODING_AGENT_DIR and .pi/agent under HOME.
export function piAgentDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = [];
  if (isSet(env.TASKER_PI_CODING_AGENT_DIR)) {
    const dir = parsePiAgentValue(env.TASKER_PI_CODING_AGENT_DIR, env);
    if (dir !== undefined) dirs.push(dir);
  }
  if (isSet(env.PI_CODING_AGENT_DIR)) {
    const dir = parsePiAgentValue(env.PI_CODING_AGENT_DIR, env);
    if (dir !== undefined) dirs.push(dir);
  }
  if (isSet(env.HOME)) dirs.push(join(env.HOME, ".pi", "agent"));
  return dirs;
}

// Expands "~" and "~/..." with HOME. Gives no path for such a key when HOME is not set. Other keys stay as they are.
export function expandPiHomeKey(key: string, home: string | undefined): string | undefined {
  if (key === "~") return isSet(home) ? home : undefined;
  if (key.startsWith("~/")) return isSet(home) ? join(home, key.slice(2)) : undefined;
  return key;
}

function parsePiAgentValue(value: string, env: NodeJS.ProcessEnv): string | undefined {
  const expanded = expandPiHomeKey(value, env.HOME);
  if (expanded !== value) return expanded;
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }
  return value;
}
