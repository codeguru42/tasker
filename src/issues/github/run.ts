import { spawn } from "node:child_process";

export interface RunGhOptions {
  account: string;
  env: NodeJS.ProcessEnv;
}

const GITHUB_HOST = "github.com";

// See the doc comment of runGh().
const REMOVED_GH_VARS = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GH_HOST",
  "GH_REPO",
] as const;

// One read of the token for each account in this process. A failed read is not kept.
const tokens = new Map<string, Promise<string>>();

// Runs gh with args (the subcommand first) as options.account, and resolves with its stdout.
// The stdout is as gh printed it, not trimmed.
// The environment of gh:
// - runGh() starts from the env of the caller.
// - It removes exactly these names: GH_TOKEN, GITHUB_TOKEN, GH_ENTERPRISE_TOKEN,
//   GITHUB_ENTERPRISE_TOKEN, GH_HOST and GH_REPO.
// - Then it sets GH_TOKEN to the token of the account, GH_PROMPT_DISABLED=1,
//   GH_NO_UPDATE_NOTIFIER=1 and NO_COLOR=1.
// - All other names pass as they are, for example GH_CONFIG_DIR, PATH and HOME.
// - The token call uses the same environment, without the new GH_TOKEN.
// The token call is `gh auth token --hostname github.com --user <account>`. With --user,
// gh 2.101.0 ignores GH_TOKEN. tasker reads the token one time for each account in one
// process. A failed read is not kept.
// runGh() does not add process.env. gh is found on the PATH of env. An env with no PATH
// or an empty one rejects before gh starts.
// gh gets no input stream. Its stdout and stderr go to pipes, never to the terminal.
// gh runs in the cwd of tasker. A call that acts on a repo must name the repo.
// runGh() writes nothing to the console or a log.
export function runGh(args: readonly string[], options: RunGhOptions): Promise<string> {
  if (args.length === 0) {
    return Promise.reject(new Error("runGh needs a gh subcommand"));
  }
  if (args[0].startsWith("-")) {
    return Promise.reject(new Error("runGh needs the gh subcommand as the first argument"));
  }
  if (!options.env.PATH) {
    return Promise.reject(new Error("gh is not installed: the env has no PATH"));
  }
  const env = ghEnv(options.env);
  return accountToken(options.account, env).then((token) =>
    spawnGh([...args], { ...env, GH_TOKEN: token }),
  );
}

// See the doc comment of runGh().
function ghEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env };
  for (const name of REMOVED_GH_VARS) {
    delete result[name];
  }
  return {
    ...result,
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    NO_COLOR: "1",
  };
}

// The token of account: the promise of the first read, or a new read.
// Two calls at the same time for one account start one token call.
function accountToken(account: string, env: NodeJS.ProcessEnv): Promise<string> {
  const known = tokens.get(account);
  if (known !== undefined) {
    return known;
  }
  const read = readToken(account, env);
  tokens.set(account, read);
  read.catch(() => {
    if (tokens.get(account) === read) {
      tokens.delete(account);
    }
  });
  return read;
}

async function readToken(account: string, env: NodeJS.ProcessEnv): Promise<string> {
  const stdout = await spawnGh(
    ["auth", "token", "--hostname", GITHUB_HOST, "--user", account],
    env,
  );
  return stdout.trim();
}

// Starts gh once and resolves with its stdout when the exit code is 0.
function spawnGh(args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("gh", args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve(Buffer.concat(out).toString("utf8"));
        return;
      }
      const stderr = Buffer.concat(err).toString("utf8").trim();
      const reason = code === null ? `was stopped by signal ${signal}` : `failed with exit code ${code}`;
      reject(new Error(`gh ${args[0]} ${reason}${stderr === "" ? "" : `: ${stderr}`}`));
    });
  });
}
