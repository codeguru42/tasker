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
}

export function forgeGh(
  dir: string,
  token: string,
  answers: readonly FakeAnswer[],
  envNames: readonly string[] = [],
): ForgeGh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "forge-gh.log");
  const tokenMatch = `"$(if [ "\${GH_TOKEN-}" = ${shellQuote(token)} ]; then printf set:true; else printf set:false; fi)"`;
  const cwd = '"set:$PWD"';
  writeFakeCommand(
    binDir,
    "gh",
    fakeAnswerScript("gh", logPath, answers, [tokenMatch, cwd, ...logEnvItems("gh", envNames)]),
  );
  const checks = answerChecks("gh", logPath);
  return {
    env: { PATH: binDir, TASKER_GH_BIN: join(binDir, "gh") },
    calls: () =>
      readFakeCalls(logPath, 2, envNames).map((call) => ({
        args: call.args,
        tokenMatches: call.leading[0] === "true",
        cwd: call.leading[1] ?? "",
        env: call.env,
      })),
    assertAnswered: checks.assertAnswered,
  };
}
