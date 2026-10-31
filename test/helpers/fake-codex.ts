import { join } from "node:path";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logEnvItems,
  readFakeCalls,
  writeFakeCommand,
} from "./fake-commands.js";
import { useTempDir } from "./temp.js";

// The arguments of the version call.
export const CODEX_VERSION_ARGS: readonly string[] = ["--version"];

// The arguments of the login call.
export const CODEX_LOGIN_STATUS_ARGS: readonly string[] = ["login", "status"];

// The measured answer of `codex login status` with no login, on codex-cli 0.166.0.
export const MEASURED_LOGGED_OUT: Omit<FakeAnswer, "args"> = { exitCode: 1, stdout: "", stderr: "Not logged in\n" };

export interface FakeCodex {
  // PATH is the folder of the fake codex alone. HOME is the temp folder.
  env: { PATH: string; HOME: string };
  // One entry for each call. env holds each name of logEnv, and undefined for a name that was not set.
  calls(): { args: string[]; env: Record<string, string | undefined> }[];
}

// A fake codex in a new temp folder (see useTempDir()). A call with no answer fails the test.
// Call it inside a test.
export function useFakeCodex(answers: readonly FakeAnswer[], logEnv: readonly string[] = []): FakeCodex {
  const dir = useTempDir("tasker-fake-codex-");
  const bin = join(dir, "bin");
  const logPath = join(dir, "codex.log");
  writeFakeCommand(bin, "codex", fakeAnswerScript("codex", logPath, answers, logEnvItems("codex", logEnv)));
  answerChecks("codex", logPath);
  return {
    env: { PATH: bin, HOME: dir },
    calls: () => readFakeCalls(logPath, 0, logEnv).map((call) => ({ args: call.args, env: call.env })),
  };
}
