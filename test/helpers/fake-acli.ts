import { join } from "node:path";
import type { IssueRef } from "../../src/issue-key/ref.js";
import { jiraShortRef } from "../../src/issue-key/short-ref.js";
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

// The measured stderr of `acli jira workitem view` for an issue that does not exist.
export const MEASURED_NOT_FOUND = "✗ Error: Issue does not exist or you do not have permission to see it.";

// The ref of a Jira issue in the repo "work".
export function jiraRefOf(key: string): IssueRef {
  return { key, repoKey: "work", shortRef: jiraShortRef(key) };
}

// The fake acli with the answer of the site guard, then the answer of the view call for viewArgs.
export function fakeAcliView(dir: string, viewArgs: readonly string[], view: Omit<FakeAcliAnswer, "args">): FakeAcli {
  return fakeAcli(dir, {}, [
    { args: AUTH_STATUS_ARGS, stdout: MEASURED_AUTH_STATUS },
    { args: [...viewArgs], ...view },
  ]);
}

// One line of JSON in the measured form of a write with `--json`: one result, totalCount 1.
export function acliWriteResult(status: string, message: string): string {
  const successCount = status === "SUCCESS" ? 1 : 0;
  return JSON.stringify({ results: [{ status, message, id: "TEST-10" }], totalCount: 1, successCount });
}
