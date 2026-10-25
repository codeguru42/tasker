import { isSet } from "../../config/path.js";
import { ProgramFileError, resolveProgram } from "../../process/resolve-program.js";
import {
  ChildCommandError,
  childFailureMessage,
  CommandNotFoundError,
  runChild,
  subcommandOf,
} from "../../process/run-child.js";

export interface RunAcliOptions {
  env: NodeJS.ProcessEnv;
  // signal stops acli with SIGTERM and rejects with an AbortError.
  signal?: AbortSignal;
}

export class AcliError extends ChildCommandError {
  constructor(message: string, subcommand: string, stdout: string, stderr: string, exitCode: number | null) {
    super(message, subcommand, stdout, stderr, exitCode);
    this.name = "AcliError";
  }
}

export class AcliNotInstalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcliNotInstalledError";
  }
}

// TASKER_ACLI_BIN names a file that does not exist, a folder, or a file that the user cannot run.
export class AcliBinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcliBinError";
  }
}

// The call is a command that only the user runs: a login, a logout, a switch of the site, or the configuration.
export class AcliRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AcliRefusedError";
  }
}

const ACLI_BIN = "TASKER_ACLI_BIN";
const REFUSED_AUTH_VERBS: readonly string[] = ["login", "logout", "switch"];

// True for an auth login, auth logout or auth switch at any place of the list, and for any config command.
function isRefused(args: readonly string[]): boolean {
  if (args[0] === "config") return true;
  return args.some((arg, index) => arg === "auth" && REFUSED_AUTH_VERBS.includes(args[index + 1]));
}

// Runs acli with args and resolves with its stdout, not trimmed. args[0] is the subcommand.
// - A list with no argument rejects. A first argument that starts with "-" rejects.
// - A call that changes the login, the site or the configuration of acli is refused with an
//   AcliRefusedError, and nothing starts. These are auth login, auth logout and auth switch at any
//   place of args, and each command that starts with config. The active site of acli is the choice of the user.
// - The program is acli, found on the PATH of env, unless env sets TASKER_ACLI_BIN (see resolveProgram()).
//   A value with a "/" must name a file that the user can run, or the call rejects with an AcliBinError.
//   A value with no "/" is a name on the PATH of env.
// - acli not found rejects with an AcliNotInstalledError.
// - An exit code other than 0, or a stop by a signal, rejects with an AcliError that holds the stdout,
//   the stderr and the exit code.
// runAcli() does not add process.env. An env with no PATH or an empty one rejects before acli starts,
// through runChild(). acli gets no input stream. Its stdout and stderr go to pipes, never to the terminal.
// options.signal stops acli with SIGTERM and rejects with an AbortError.
// acli runs in the cwd of tasker. runAcli() has no cwd option.
// runAcli() writes nothing to the console or a log.
export async function runAcli(args: readonly string[], options: RunAcliOptions): Promise<string> {
  if (args.length === 0) {
    throw new Error("runAcli needs an acli subcommand");
  }
  if (args[0].startsWith("-")) {
    throw new Error("runAcli needs the acli subcommand as the first argument");
  }
  if (isRefused(args)) {
    throw new AcliRefusedError(`tasker never runs acli ${args.join(" ")}: only the user runs it`);
  }
  let program: string;
  try {
    program = resolveProgram("acli", ACLI_BIN, options.env);
  } catch (error) {
    if (error instanceof ProgramFileError) throw new AcliBinError(error.message);
    throw error;
  }
  let result;
  try {
    result = await runChild(program, args, { env: options.env, signal: options.signal });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      const value = options.env[ACLI_BIN];
      const shown = isSet(value) ? value : "acli";
      throw new AcliNotInstalledError(`${shown} is not installed: install acli, or fix ${ACLI_BIN}`);
    }
    throw error;
  }
  if (result.code === 0) return result.stdout;
  const subcommand = subcommandOf(args);
  throw new AcliError(
    childFailureMessage("acli", subcommand, result.code, result.signal, result.stderr),
    subcommand,
    result.stdout,
    result.stderr,
    result.code,
  );
}
