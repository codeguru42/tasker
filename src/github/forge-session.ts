import { isSet } from "../config/path.js";
import { type ChildResult } from "../process/run-child.js";
import { GhProcessError, runGhProcess } from "./process.js";

export interface GhSession {
  run(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): Promise<string>;
}

const forbiddenCommands = new Set(["token", "login", "logout", "switch"]);
const forbiddenEnvironment = ["TASKER_GH_TOKEN", "TASKER_GH_HOST", "TASKER_GH_REPO"] as const;

class GhLoginError extends Error {
  constructor(account: string) {
    super(`gh has no login for the account ${account}: run \`gh auth login\` and log in as ${account}`);
    this.name = "GhLoginError";
  }
}

export function createGhSession(account: string): GhSession {
  if (!isSet(account)) throw new Error("a GitHub account is required");

  let token: string | undefined;
  let tokenRead: Promise<string> | undefined;

  return {
    run(args, cwd, env) {
      if (args.length === 0) return Promise.reject(new Error("a gh command is required"));
      const [command, subcommand] = args;
      if (command.startsWith("-")) return Promise.reject(new Error("the first gh argument must be a command"));
      if (command === "auth" && forbiddenCommands.has(subcommand ?? "")) {
        return Promise.reject(new Error(`gh auth ${subcommand} is managed outside the forge session`));
      }
      if ((command === "pr" && subcommand === "checkout") || (command === "repo" && subcommand === "sync")) {
        return Promise.reject(new Error(`gh ${command} ${subcommand} changes the local branch`));
      }
      if (command === "repo" && subcommand === "create" && args.includes("--push")) {
        return Promise.reject(new Error("gh repo create --push publishes a branch"));
      }

      for (const name of forbiddenEnvironment) {
        if (env[name] !== undefined) return Promise.reject(new Error(`${name} must not be supplied`));
      }
      if (!isSet(env.TASKER_PATH)) return Promise.reject(new Error("TASKER_PATH must be a nonblank path"));
      if (!isSet(env.TASKER_HOME) && !isSet(env.TASKER_GH_CONFIG_DIR)) {
        return Promise.reject(new Error("TASKER_HOME or TASKER_GH_CONFIG_DIR must be nonblank"));
      }

      const childEnv: NodeJS.ProcessEnv = {
        PATH: env.TASKER_PATH,
        ...(isSet(env.TASKER_HOME) ? { TASKER_HOME: env.TASKER_HOME } : {}),
        ...(isSet(env.TASKER_GH_CONFIG_DIR) ? { TASKER_GH_CONFIG_DIR: env.TASKER_GH_CONFIG_DIR } : {}),
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      };
      const programEnv = { ...childEnv, TASKER_GH_BIN: env.TASKER_GH_BIN };
      return accountToken(childEnv, programEnv).then((accountTokenValue) =>
        runGhProcess(
          args,
          { ...childEnv, GH_TOKEN: accountTokenValue },
          { cwd, programEnv, token: accountTokenValue },
        ).then((result) => result.stdout),
      );
    },
  };

  function accountToken(childEnv: NodeJS.ProcessEnv, programEnv: NodeJS.ProcessEnv): Promise<string> {
    if (token !== undefined) return Promise.resolve(token);
    if (tokenRead !== undefined) return tokenRead;

    const read = readAccountToken(account, childEnv, programEnv);
    tokenRead = read;
    read.then(
      (value) => {
        token = value;
        tokenRead = undefined;
      },
      () => {
        tokenRead = undefined;
      },
    );
    return read;
  }
}

async function readAccountToken(
  account: string,
  childEnv: NodeJS.ProcessEnv,
  programEnv: NodeJS.ProcessEnv,
): Promise<string> {
  let result: ChildResult;
  try {
    result = await runGhProcess(["auth", "token", "--user", account], childEnv, { programEnv, dropStdout: true });
  } catch (error) {
    if (error instanceof GhProcessError) throw new GhLoginError(account);
    throw error;
  }
  const accountTokenValue = result.stdout.trim();
  if (accountTokenValue === "") throw new GhLoginError(account);
  return accountTokenValue;
}
