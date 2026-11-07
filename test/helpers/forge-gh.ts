import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { shellQuote } from "../../src/shell-quote.js";
import { useProcessEnv, useTempDir } from "./temp.js";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logLine,
  logEnvItems,
  readFakeCalls,
  realCommandPath,
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
  setMergeStates(states: readonly string[]): void;
}

export const OPEN_PR_FORGE_ACCOUNT = "forge-team";
export const OPEN_PR_FORGE_TOKEN = "forge-token-private";

export function openPrTokenAnswer() {
  return {
    args: ["auth", "token", "--user", OPEN_PR_FORGE_ACCOUNT],
    stdout: `${OPEN_PR_FORGE_TOKEN}\n`,
  };
}

export function openPrListArgs(head: string): string[] {
  return [
    "pr",
    "list",
    "--head",
    head,
    "--state",
    "open",
    "--json",
    "number,url,baseRefName,isCrossRepository",
    "--limit",
    "100",
  ];
}

export function installForgeGh(answers: readonly FakeAnswer[], prefix: string): ForgeGh {
  const fake = forgeGh(useTempDir(prefix), OPEN_PR_FORGE_TOKEN, answers);
  useProcessEnv({
    TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
    TASKER_PATH: `${String(fake.env.PATH)}:${String(process.env.PATH)}`,
    TASKER_GH_CONFIG_DIR: "/tasker/open-pr-forge-gh-config",
    TASKER_HOME: "/tasker/open-pr-forge-home",
  });
  return fake;
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
  let mergeStates: readonly string[] | undefined;
  const stateIndexPath = join(dir, "state-index");
  const encodedToken = Buffer.from(token).toString("base64");
  const decodedToken = `$(printf '%s' ${shellQuote(encodedToken)} | ${shellQuote(realCommandPath("base64"))} -d)`;
  const tokenMatch = `"$(if [ "\${GH_TOKEN-}" = "${decodedToken}" ]; then printf set:true; else printf set:false; fi)"`;
  const cwd = '"set:$PWD"';
  const extra = [tokenMatch, cwd, ...logEnvItems("gh", safeEnvNames)];
  const write = () => {
    const encodedAnswers = currentAnswers.map(({ stdout, stderr, ...answer }) => ({
      ...answer,
      ...(stdout ? { stdoutBase64: Buffer.from(stdout).toString("base64") } : { stdout: "" }),
      ...(stderr ? { stderrBase64: Buffer.from(stderr).toString("base64") } : { stderr: "" }),
    }));
    const script = fakeAnswerScript("gh", logPath, encodedAnswers, extra);
    const stateScript =
      mergeStates === undefined
        ? ""
        : [
            'if [ "$1" = "pr" ] && [ "$2" = "view" ] && [ "$3" = "42" ] && [ "$4" = "--json" ] && [ "$5" = "state" ]; then',
            `  read -r state_index < ${shellQuote(stateIndexPath)}`,
            '  case "$state_index" in',
            ...mergeStates.map(
              (state, index) => `    ${index}) printf '%s' ${shellQuote(JSON.stringify({ state }))} ;;`,
            ),
            `    *) printf '%s' ${shellQuote(JSON.stringify({ state: mergeStates.at(-1) }))} ;;`,
            "  esac",
            `  printf '%s\n' "$((state_index + 1))" > ${shellQuote(stateIndexPath)}`,
            "  exit 0",
            "fi",
          ].join("\n");
    const guard =
      remoteHead === undefined
        ? ""
        : [
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
    writeFakeCommand(
      binDir,
      "gh",
      `${script.slice(0, logLineEnd)}\n${stateScript}\n${guard}${script.slice(logLineEnd)}`,
    );
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
    setMergeState: (state) => {
      mergeStates = undefined;
      setAnswer(["pr", "view", "42", "--json", "state"], JSON.stringify({ state }));
    },
    setMergeStates: (states) => {
      if (states.length === 0) throw new Error("merge states must not be empty");
      mergeStates = [...states];
      writeFileSync(stateIndexPath, "0\n");
      write();
    },
  };
}
