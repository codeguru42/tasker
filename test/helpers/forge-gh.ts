import { join } from "node:path";
import { shellQuote } from "../../src/shell-quote.js";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logEnvItems,
  readFakeCalls,
  writeFakeCommand,
} from "./fake-commands.js";

export interface ForgeGhCall {
  args: string[];
  tokenMatches: boolean;
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface ForgeGh {
  env: NodeJS.ProcessEnv;
  calls(): ForgeGhCall[];
  assertAnswered(): void;
  setRemoteHead(head: string): void;
  setMergeState(state: string): void;
}

export function forgeGh(
  dir: string,
  token: string,
  answers: readonly FakeAnswer[],
  envNames: readonly string[] = [],
): ForgeGh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "forge-gh.log");
  const safeEnvNames = envNames.filter((name) => name !== "GH_TOKEN");
  const currentAnswers = [...answers];
  const tokenMatch = `"$(if [ "\${GH_TOKEN-}" = ${shellQuote(token)} ]; then printf set:true; else printf set:false; fi)"`;
  const cwd = '"set:$PWD"';
  const extra = [tokenMatch, cwd, ...logEnvItems("gh", safeEnvNames)];
  const write = () => writeFakeCommand(binDir, "gh", fakeAnswerScript("gh", logPath, currentAnswers, extra));
  const setAnswer = (args: readonly string[], stdout: string) => {
    const index = currentAnswers.findIndex((answer) => answer.args.join("\0") === args.join("\0"));
    const answer: FakeAnswer = { args, stdout };
    if (index === -1) currentAnswers.unshift(answer);
    else currentAnswers[index] = answer;
    write();
  };
  write();
  const checks = answerChecks("gh", logPath);
  return {
    env: { PATH: binDir, TASKER_GH_BIN: join(binDir, "gh") },
    calls: () =>
      readFakeCalls(logPath, 2, safeEnvNames).map((call) => ({
        args: call.args,
        tokenMatches: call.leading[0] === "true",
        cwd: call.leading[1] ?? "",
        env: call.env,
      })),
    assertAnswered: checks.assertAnswered,
    setRemoteHead: (head) => setAnswer(["pr", "view", "42", "--json", "headRefOid"], head),
    setMergeState: (state) => setAnswer(["pr", "view", "42", "--json", "state"], state),
  };
}
