import {
  ChildCommandError,
  type ChildResult,
  childFailureMessage,
  runChild,
  subcommandOf,
} from "../process/run-child.js";
import { resolveProgram } from "../process/resolve-program.js";
import { startFolderError } from "../process/start-folder.js";

export { ChildCommandError, CommandNotFoundError } from "../process/run-child.js";

export interface RunGhProcessOptions {
  cwd?: string;
  signal?: AbortSignal;
  dropStdout?: boolean;
  token?: string;
  programEnv?: NodeJS.ProcessEnv;
}

export class GhProcessError extends ChildCommandError {
  constructor(message: string, subcommand: string, stdout: string, stderr: string, exitCode: number | null) {
    super(message, subcommand, stdout, stderr, exitCode);
    this.name = "GhProcessError";
  }
}

export async function runGhProcess(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  options: RunGhProcessOptions = {},
): Promise<ChildResult> {
  const program = resolveProgram("gh", "TASKER_GH_BIN", options.programEnv ?? env);
  if (options.cwd !== undefined) {
    const folderError = startFolderError(program, options.cwd);
    if (folderError !== undefined) throw new Error(folderError);
  }
  const result: ChildResult = await runChild(program, args, { env, cwd: options.cwd, signal: options.signal });
  const hide = (text: string) => (options.token === undefined ? text : text.split(options.token).join("***"));
  const { code, signal, stdout } = result;
  if (code === 0) return result;
  const subcommand = subcommandOf(args);
  const shownStdout = options.dropStdout ? "" : hide(stdout);
  const stderr = hide(result.stderr);
  throw new GhProcessError(
    childFailureMessage("gh", subcommand, code, signal, stderr),
    subcommand,
    shownStdout,
    stderr,
    code,
  );
}
