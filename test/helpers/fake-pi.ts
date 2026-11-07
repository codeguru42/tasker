import { join } from "node:path";
import type { FakeAnswer } from "./fake-commands.js";
import { answerChecks, fakeAnswerScript, logEnvItems, readFakeCalls, writeFakeCommand } from "./fake-commands.js";
import { useTempDir } from "./temp.js";

export interface FakePi {
  env: NodeJS.ProcessEnv;
  logPath: string;
  calls(): { args: string[]; env: Record<string, string | undefined> }[];
  unanswered(): string[][];
}

export function useFakePi(_answers: readonly FakeAnswer[], _logEnv: readonly string[] = []): FakePi {
  const dir = useTempDir("tasker-fake-pi-");
  const bin = join(dir, "bin");
  const program = join(bin, "pi");
  const logPath = join(dir, "pi.log");
  writeFakeCommand(bin, "pi", fakeAnswerScript("pi", logPath, _answers, logEnvItems("pi", _logEnv)));
  const checks = answerChecks("pi", logPath);
  return {
    env: { PATH: bin, TASKER_PI_BIN: program },
    logPath,
    calls: () => readFakeCalls(logPath, 0, _logEnv).map((call) => ({ args: call.args, env: call.env })),
    unanswered: checks.unanswered,
  };
}
