import { isSet, resolveConfigPath } from "../config/path.js";
import { join } from "node:path";

// The one home of the read deny list of the shell of the execute role. No other code builds a part of it.
// Each entry goes in only when the variables that it needs are set. Every value comes from env, never from
// the home folder of the host. A path that does not exist still goes in the list.
export function executeReadDenyPaths(o: {
  env: NodeJS.ProcessEnv;
  surfaceDenyReadPaths: readonly string[];
  publishTokensPath: string;
}): string[] {
  const { env } = o;
  const home = isSet(env.HOME) ? env.HOME : undefined;
  const paths = [...o.surfaceDenyReadPaths];
  if (home) paths.push(join(home, ".ssh"));
  if (isSet(env.GH_CONFIG_DIR)) paths.push(env.GH_CONFIG_DIR);
  else if (isSet(env.XDG_CONFIG_HOME)) paths.push(join(env.XDG_CONFIG_HOME, "gh"));
  else if (home) paths.push(join(home, ".config", "gh"));
  if (home) paths.push(join(home, ".git-credentials"), join(home, ".netrc"));
  if (isSet(env.CLAUDE_CONFIG_DIR)) paths.push(join(env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  else if (home) paths.push(join(home, ".claude", ".credentials.json"));
  paths.push(o.publishTokensPath);
  // resolveConfigPath() reads its homedir argument only when TASKER_CONFIG and XDG_CONFIG_HOME are
  // unset, and the default of that argument is the home folder of the host. So the entry goes in
  // only when the env names the file or a folder for it, and the call never passes undefined.
  if (isSet(env.TASKER_CONFIG) || isSet(env.XDG_CONFIG_HOME) || isSet(env.HOME)) {
    paths.push(resolveConfigPath(env, env.HOME ?? ""));
  }
  return paths;
}
