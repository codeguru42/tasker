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
// waiters counts the callers of runGh() that wait for the read. stop stops the token call.
// settled is true when the read has resolved or rejected.
interface TokenRead {
  read: Promise<string>;
  stop: AbortController;
  waiters: number;
  settled: boolean;
}

const tokens = new Map<string, TokenRead>();

// The same error that runChild() gives when a signal aborts.
function abortError(): Error {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

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
// options.signal stops gh with SIGTERM and rejects with an AbortError. These rules hold:
// 1. A signal that already aborted rejects before any gh starts and before the token cache is read.
// 2. A caller that waits for the token read counts as a waiter. It joins when it starts to wait.
//    It leaves once: when the read settles, or when its signal aborts. A caller with no signal
//    leaves only when the read settles, so it never stops the read.
// 3. When the signal of a caller aborts, that caller rejects at once with an AbortError.
//    The other callers keep waiting.
// 4. When the last waiter leaves by an abort while the read is pending, runGh() stops the token
//    call. In the same step, it deletes the read from the cache, if it is still the read of the
//    account. As a result, a later caller starts a new read and never joins the stopped one.
// 5. When the read settles first, the caller gets the token or the error.
// 6. Then the main call runs with the signal of the caller.
// gh runs in the cwd of tasker. A call that acts on a repo must name the repo. runGh() has no cwd option.
// runGh() writes nothing to the console or a log.
export function runGh(args: readonly string[], options: RunGhOptions): Promise<string> {
  if (args.length === 0) {
    return Promise.reject(new Error("runGh needs a gh subcommand"));
  }
  if (args[0].startsWith("-")) {
    return Promise.reject(new Error("runGh needs the gh subcommand as the first argument"));
  }
  if (options.signal?.aborted) {
    return Promise.reject(abortError());
  }
  const env = ghEnv(options.env);
  return accountToken(options.account, env, options.signal).then((token) =>
    spawnGh([...args], { ...env, GH_TOKEN: token }, { token, signal: options.signal }),
  );
}

// Runs `gh --version` with the env of runGh() and no token, and resolves with its stdout.
// The version check needs no login, so it makes no token call. signal stops gh.
export function readGhVersion(
  env: NodeJS.ProcessEnv,
  options: { signal?: AbortSignal } = {},
): Promise<string> {
  return spawnGh(["--version"], ghEnv(env), { signal: options.signal });
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

// The token of account: the read of another call, or a new read. The caller waits for the read
// until it settles or until signal aborts. See the doc comment of runGh() for the rules.
// Two calls at the same time for one account start one token call.
function accountToken(
  account: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal | undefined,
): Promise<string> {
  const entry = tokens.get(account) ?? startRead(account, env);
  entry.waiters += 1;
  return new Promise<string>((resolve, reject) => {
    let left = false;
    const leave = () => {
      left = true;
      entry.waiters -= 1;
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (left) return;
      leave();
      if (entry.waiters === 0 && !entry.settled) {
        entry.stop.abort();
        if (tokens.get(account) === entry) {
          tokens.delete(account);
        }
      }
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    entry.read.then(
      (token) => {
        if (left) return;
        leave();
        resolve(token);
      },
      (error: unknown) => {
        if (left) return;
        leave();
        reject(error);
      },
    );
  });
}

function startRead(account: string, env: NodeJS.ProcessEnv): TokenRead {
  const stop = new AbortController();
  const read = readToken(account, env, stop.signal);
  const entry: TokenRead = { read, stop, waiters: 0, settled: false };
  tokens.set(account, entry);
  const settle = () => {
    entry.settled = true;
  };
  read.then(settle, settle);
  read.catch(() => {
    if (tokens.get(account) === entry) {
      tokens.delete(account);
    }
  });
  return entry;
}

// Reads the token of account. The token call never puts its stdout into an error.
async function readToken(
  account: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
): Promise<string> {
  const args = ["auth", "token", "--hostname", GITHUB_HOST, "--user", account];
  let stdout: string;
  try {
    stdout = await spawnGh(args, env, { dropStdout: true, signal });
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
