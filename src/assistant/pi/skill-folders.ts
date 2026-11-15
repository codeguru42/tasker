import { join } from "node:path";
import { isSet } from "../../config/path.js";

// The two skill folders of pi: the one in the agent folder, then the one under HOME.
export function piSkillFolders(
  agentDir: string | undefined,
  home: string | undefined,
): { agentFolder: string | undefined; homeFolder: string | undefined } {
  return {
    agentFolder: agentDir === undefined ? undefined : join(agentDir, "skills"),
    homeFolder: isSet(home) ? join(home, ".agents", "skills") : undefined,
  };
}
