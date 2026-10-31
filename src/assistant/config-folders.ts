import { join } from "node:path";
import { isSet } from "../config/path.js";

// The configuration folder of claude: CLAUDE_CONFIG_DIR, else .claude under HOME, else none.
export function claudeConfigDir(env: NodeJS.ProcessEnv): string | undefined {
  if (isSet(env.CLAUDE_CONFIG_DIR)) return env.CLAUDE_CONFIG_DIR;
  return isSet(env.HOME) ? join(env.HOME, ".claude") : undefined;
}
