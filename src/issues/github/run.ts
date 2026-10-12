import { type ChildResult, CommandNotFoundError, runChild } from "../../process/run-child.js";

export interface RunGhOptions {
  account: string;
  env: NodeJS.ProcessEnv;
  // signal stops gh with SIGTERM and rejects with an AbortError.
  signal?: AbortSignal;
}

export class GhError extends Error {
  readonly subcommand: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;

  constructor(
    message: string,
    subcommand: string,
    stdout: string,
    stderr: string,
    exitCode: number | null,
  ) {
    super(message);
    this.name = "GhError";
    this.subcommand = subcommand;
    this.stdout = stdout;
    this.stderr = stderr;
    this.exitCode = exitCode;
  }
}

export class GhNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhNotInstalledError";
  }
}

// The account has no token on github.com. The error holds no stdout, because the stdout of
// the token call can hold a token.
export class GhLoginError extends Error {
  readonly account: string;

  constructor(account: string, stderr: string) {
    const detail = stderr.trim();
    super(
      `gh has no login for the account ${account} on github.com: run \`gh auth login --hostname github.com\` and log in as ${account}` +
        (detail === "" ? "" : `. gh said: ${detail}`),
    );
    this.name = "GhLoginError";
    this.account = account;
  }
}

const GITHUB_HOST = "github.com";
const REDACTED = "***";

// The subcommand of a gh call: args[0], plus args[1] when args[1] exists and does not start
// with "-", joined with one space. Examples:
// - issue view 7 gives "issue view".
// - api graphql -f query=... gives "api graphql".
// - api -X PATCH repos/a/b gives "api".
// - api user gives "api user".
function subcommandOf(args: readonly string[]): string {
  const second = args[1];
  return second !== undefined && !second.startsWith("-") ? `${args[0]} ${second}` : args[0];
}

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
// or an empty one rejects before gh starts, through runChild().
// gh gets no input stream. Its stdout and stderr go to pipes, never to the terminal.
// options.signal stops the main call of gh with SIGTERM. Then runGh() rejects with an AbortError.
// gh runs in the cwd of tasker. A call that acts on a repo must name the repo. runGh() has no cwd option.
// runGh() writes nothing to the console or a log.
export function runGh(args: readonly string[], options: RunGhOptions): Promise<string> {
  if (args.length === 0) {
    return Promise.reject(new Error("runGh needs a gh subcommand"));
  }
  if (args[0].startsWith("-")) {
    return Promise.reject(new Error("runGh needs the gh subcommand as the first argument"));
  }
  const env = ghEnv(options.env);
  return accountToken(options.account, env).then((token) =>
    spawnGh([...args], { ...env, GH_TOKEN: token }, { token, signal: options.signal }),
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

// Reads the token of account. The token call never puts its stdout into an error.
async function readToken(account: string, env: NodeJS.ProcessEnv): Promise<string> {
  const args = ["auth", "token", "--hostname", GITHUB_HOST, "--user", account];
  let stdout: string;
  try {
    stdout = await spawnGh(args, env, { dropStdout: true });
  } catch (error) {
    if (error instanceof GhError && error.exitCode !== null) {
      throw new GhLoginError(account, error.stderr);
    }
    throw error;
  }
  const token = stdout.trim();
  if (token === "") {
    throw new GhLoginError(account, "");
  }
  return token;
}

// Starts gh once and resolves with its stdout when the exit code is 0.
// dropStdout: each error has an empty stdout (the token call). token: each error has
// *** in place of the token, in stdout, stderr and message (a main call).
async function spawnGh(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  mode: { dropStdout?: boolean; token?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const hide = (text: string) =>
    mode.token === undefined ? text : text.split(mode.token).join(REDACTED);
  let result: ChildResult;
  try {
    result = await runChild("gh", args, { env, signal: mode.signal });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      throw new GhNotInstalledError(error.message);
    }
    throw error;
  }
  const { code, signal, stdout } = result;
  if (code === 0) {
    return stdout;
  }
  const subcommand = subcommandOf(args);
  const shownStdout = mode.dropStdout ? "" : hide(stdout);
  const stderr = hide(result.stderr);
  if (code === null) {
    throw new GhError(
      `gh ${subcommand} was stopped by signal ${signal}`,
      subcommand,
      shownStdout,
      stderr,
      null,
    );
  }
  const detail = stderr.trim();
  const reason = detail === "" ? "" : `: ${detail}`;
  throw new GhError(
    `gh ${subcommand} failed with exit code ${code}${reason}`,
    subcommand,
    shownStdout,
    stderr,
    code,
  );
}
