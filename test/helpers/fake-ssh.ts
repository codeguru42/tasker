import { userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { shellQuote } from "../../src/vcs/git/ssh.js";
import { logLine, writeFakeCommand } from "./fake-commands.js";

// How a fake ssh behaves (see writeFakeSsh()).
export type FakeSshMode =
  | "serve"
  | "refuse"
  | "hang"
  | { greet: string; repo: "serve" | "missing" };

// Writes an executable ssh into binDir. Each call goes in the log at logPath (see readArgLog()).
// "serve" runs the last argument in a shell, so the real git-upload-pack on PATH serves a local origin.
// "refuse" prints what ssh prints for a missing key file at $2, then exits with 255.
// "hang" runs sleep 5 after it writes the log.
// { greet, repo } acts like GitHub. When the last argument starts with "git-", it serves the repo
// ("serve"), or it prints "ERROR: Repository not found." and exits with 1 ("missing").
// Else it prints the greeting for the account greet to stderr and exits with 1.
// Use the remote ssh://tasker.invalid<origin.path> and PATH=<binDir>:<process.env.PATH>.
export function writeFakeSsh(binDir: string, logPath: string, mode: FakeSshMode): void {
  let body: string[];
  if (mode === "serve") {
    body = [logLine(logPath), "for last; do :; done", 'exec sh -c "$last"'];
  } else if (mode === "hang") {
    body = [logLine(logPath), "exec sleep 5"];
  } else if (mode === "refuse") {
    body = [
      logLine(logPath),
      `home=${shellQuote(userInfo().homedir)}`,
      'case "$2" in',
      '  "~/"*) key="$home${2#"~"}" ;;',
      '  *) key="$2" ;;',
      "esac",
      'printf \'Warning: Identity file %s not accessible: No such file or directory.\\n\' "$key" >&2',
      "echo 'Permission denied (publickey).' >&2",
      "exit 255",
    ];
  } else {
    const greeting = `Hi ${mode.greet}! You've successfully authenticated, but GitHub does not provide shell access.`;
    body = [
      logLine(logPath),
      "for last; do :; done",
      'case "$last" in',
      "  git-*)",
      ...(mode.repo === "serve"
        ? ['    exec sh -c "$last" ;;']
        : ["    echo 'ERROR: Repository not found.' >&2", "    exit 1 ;;"]),
      "  *)",
      `    echo ${shellQuote(greeting)} >&2`,
      "    exit 1 ;;",
      "esac",
    ];
  }
  writeFakeCommand(binDir, "ssh", body.join("\n"));
}

export interface FakeSsh {
  // baseEnv with PATH=<dir>/bin<delimiter><process.env.PATH>, so git starts the fake ssh.
  env: NodeJS.ProcessEnv;
  // The log of the fake ssh. readArgLog() reads it.
  logPath: string;
  // The ssh remote for a repo path: ssh://tasker.invalid<path>.
  remote(path: string): string;
}

// Writes a fake ssh into <dir>/bin with writeFakeSsh(), with the log <dir>/ssh.log.
// A second call with the same dir replaces the script and keeps the log.
export function fakeSsh(
  dir: string,
  baseEnv: NodeJS.ProcessEnv,
  mode: FakeSshMode,
): FakeSsh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "ssh.log");
  writeFakeSsh(binDir, logPath, mode);
  return {
    env: { ...baseEnv, PATH: `${binDir}${delimiter}${process.env.PATH}` },
    logPath,
    remote: (path) => `ssh://tasker.invalid${path}`,
  };
}
