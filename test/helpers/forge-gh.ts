import { join } from "node:path";
import { shellQuote } from "../../src/shell-quote.js";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logLine,
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
  let remoteHead: string | undefined;
  const tokenMatch = `"$(if [ "\${GH_TOKEN-}" = ${shellQuote(token)} ]; then printf set:true; else printf set:false; fi)"`;
  const cwd = '"set:$PWD"';
  const extra = [tokenMatch, cwd, ...logEnvItems("gh", safeEnvNames)];
  const write = () => {
    const script = fakeAnswerScript("gh", logPath, currentAnswers, extra);
    if (remoteHead === undefined) {
      writeFakeCommand(binDir, "gh", script);
      return;
    }
    const guard = [
      'if [ "$1" = "pr" ] && [ "$2" = "merge" ]; then',
      "  has_match_head=0",
      "  match_head=",
      "  previous_arg=",
      "  for arg do",
      '    if [ "$previous_arg" = "--match-head-commit" ]; then has_match_head=1; match_head="$arg"; break; fi',
      '    previous_arg="$arg"',
      "  done",
      `  if [ "$has_match_head" = "1" ] && [ "$match_head" != ${shellQuote(remoteHead)} ]; then`,
      "    printf '%s\\n' 'fake gh: --match-head-commit does not match the current remote head' >&2",
      "    exit 1",
      "  fi",
      "fi",
    ].join("\n");
    const logLineEnd = script.indexOf(logLine(logPath, extra)) + logLine(logPath, extra).length;
    writeFakeCommand(binDir, "gh", `${script.slice(0, logLineEnd)}\n${guard}${script.slice(logLineEnd)}`);
  };
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
    setRemoteHead: (head) => {
      remoteHead = head;
      setAnswer(["pr", "view", "42", "--json", "headRefOid"], head);
    },
    setMergeState: (state) => setAnswer(["pr", "view", "42", "--json", "state"], JSON.stringify({ state })),
  };
}
