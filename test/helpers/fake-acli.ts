import { join } from "node:path";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logEnvItems,
  readFakeCalls,
  writeFakeCommand,
} from "./fake-commands.js";

// One canned answer of the fake acli. See FakeAnswer.
export type FakeAcliAnswer = FakeAnswer;

// One call that the fake acli logged.
export interface FakeAcliCall {
  args: string[];
  // Each name of logEnv. undefined when the name was not set.
  env: Record<string, string | undefined>;
}

// Writes an executable named name into binDir. It uses shell builtins, so it works with binDir as the
// only PATH folder. Only for a delay, it runs the real sleep by its absolute path. As a result, the
// real acli can never run. Each call goes in the log at logPath (see readArgLog()).
// The log of a call holds "${NAME+set:$NAME}" for each name of logEnv, then the arguments.
// An empty item means that the name was not set. "set:<value>" means that it was set to <value>.
// A call that no answer matches goes in the log <logPath>.unanswered, prints an error and exits with 99.
export function writeFakeAcli(
  binDir: string,
  logPath: string,
  answers: readonly FakeAcliAnswer[],
  logEnv: readonly string[] = [],
  name = "acli",
): void {
  const extra = logEnvItems("acli", logEnv);
  writeFakeCommand(binDir, name, fakeAnswerScript("acli", logPath, answers, extra));
}

export interface FakeAcli {
  // baseEnv with PATH=<dir>/bin and TASKER_ACLI_BIN=<dir>/bin/acli.
  env: NodeJS.ProcessEnv;
  // <dir>/acli.log. readArgLog() reads it.
  logPath: string;
  calls(): FakeAcliCall[];
  // The argument lists that had no answer.
  unanswered(): string[][];
  // Throws when unanswered() is not empty. fakeAcli() registers it with answerChecks().
  assertAnswered(): void;
}

// Writes a fake acli into <dir>/bin with writeFakeAcli(), with the log <dir>/acli.log.
// A call with no answer fails the test, also when the code under test catches the error.
// Call it in a test or in beforeEach. A second call with the same dir replaces the script and keeps the log.
export function fakeAcli(
  dir: string,
  baseEnv: NodeJS.ProcessEnv,
  answers: readonly FakeAcliAnswer[],
  options: { logEnv?: readonly string[] } = {},
): FakeAcli {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "acli.log");
  const logEnv = options.logEnv ?? [];
  writeFakeAcli(binDir, logPath, answers, logEnv);
  const checks = answerChecks("acli", logPath);
  const fake: FakeAcli = {
    env: { ...baseEnv, PATH: binDir, TASKER_ACLI_BIN: join(binDir, "acli") },
    logPath,
    calls: () => readFakeCalls(logPath, 0, logEnv).map((call) => ({ args: call.args, env: call.env })),
    unanswered: checks.unanswered,
    assertAnswered: checks.assertAnswered,
  };
  return fake;
}

// The args of the call that reads the active site.
export const AUTH_STATUS_ARGS = ["jira", "auth", "status"];

// The measured stdout of `acli jira auth status` with one login.
export const MEASURED_AUTH_STATUS = [
  "✓ Authenticated",
  "  Site: codeguru42.atlassian.net",
  "  Email: user@example.com",
  "  Authentication Type: oauth_global",
  "",
].join("\n");
