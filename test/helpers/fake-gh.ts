import { join } from "node:path";
import {
  answerChecks,
  type FakeAnswer,
  fakeAnswerScript,
  logEnvItems,
  readFakeCalls,
  writeFakeCommand,
} from "./fake-commands.js";

// One canned answer of the fake gh. See FakeAnswer.
export type FakeGhAnswer = FakeAnswer;

// One call that the fake gh logged.
export interface FakeGhCall {
  args: string[];
  // undefined when GH_TOKEN was not set.
  ghToken: string | undefined;
  // Each name of logEnv. undefined when the name was not set.
  env: Record<string, string | undefined>;
}

// The answer of gh auth token for account.
export function ghTokenAnswer(account: string, token: string): FakeGhAnswer {
  return {
    args: ["auth", "token", "--hostname", "github.com", "--user", account],
    stdout: `${token}\n`,
  };
}

// The answer of the call that reads one GitHub issue (see readGithubIssue()).
export function githubIssueAnswer(issue: {
  project: string;
  number: number;
  title?: string;
  state?: "OPEN" | "CLOSED";
  labels?: readonly string[];
}): FakeGhAnswer {
  return {
    args: ["issue", "view", String(issue.number), "-R", issue.project, "--json", "number,title,body,url,labels,state"],
    stdout: JSON.stringify({
      number: issue.number,
      title: issue.title ?? `Issue ${issue.number}`,
      body: "",
      url: `https://github.com/${issue.project}/issues/${issue.number}`,
      labels: (issue.labels ?? []).map((name) => ({ name })),
      state: issue.state ?? "OPEN",
    }),
  };
}

// The answer of one tracker write: gh issue edit or gh issue close for an issue. rest holds the flags after -R project.
export function githubWriteAnswer(write: {
  project: string;
  number: number;
  verb: "edit" | "close";
  rest: readonly string[];
  stderr?: string;
  exitCode?: number;
}): FakeGhAnswer {
  return {
    args: ["issue", write.verb, String(write.number), "-R", write.project, ...write.rest],
    stderr: write.stderr,
    exitCode: write.exitCode,
  };
}

// The argument lists of the calls of gh that wrote to an issue (issue edit or issue close), in order.
export function trackerWriteCalls(gh: FakeGh): string[][] {
  return gh
    .calls()
    .map((call) => call.args)
    .filter(([command, verb]) => command === "issue" && (verb === "edit" || verb === "close"));
}

// The labels of an issue after the logged writes of gh. It starts from issue.labels and applies each logged
// issue edit call of the issue in order: --add-label adds a label once, --remove-label removes it. It models
// GitHub, so a test can use it as an expected value. It does not read the code under test.
export function githubLabelsAfter(
  gh: FakeGh,
  issue: { project: string; number: number; labels?: readonly string[] },
): string[] {
  const labels = [...(issue.labels ?? [])];
  for (const args of trackerWriteCalls(gh)) {
    const [, verb, number, flagR, project, flag, label] = args;
    if (verb !== "edit" || number !== String(issue.number) || flagR !== "-R" || project !== issue.project) continue;
    if (flag === "--add-label" && !labels.includes(label)) labels.push(label);
    if (flag === "--remove-label" && labels.includes(label)) labels.splice(labels.indexOf(label), 1);
  }
  return labels;
}

// Writes an executable gh into binDir. It uses shell builtins, so it works with binDir as the
// only PATH folder. Only for a delay, it runs the real sleep by its absolute path. As a result, the
// real gh can never run. Each call goes in the log at logPath (see readArgLog()).
// The log of a call holds "${GH_TOKEN+set:$GH_TOKEN}", then the same for each name of logEnv, then the arguments.
// An empty item means that the name was not set. "set:<value>" means that it was set to <value>.
// A call that no answer matches goes in the log <logPath>.unanswered, prints an error and exits with 99.
export function writeFakeGh(
  binDir: string,
  logPath: string,
  answers: readonly FakeGhAnswer[],
  logEnv: readonly string[] = [],
): void {
  const extra = logEnvItems("gh", ["GH_TOKEN", ...logEnv]);
  writeFakeCommand(binDir, "gh", fakeAnswerScript("gh", logPath, answers, extra));
}

export interface FakeGh {
  // baseEnv with PATH=<dir>/bin and nothing else on PATH.
  env: NodeJS.ProcessEnv;
  // <dir>/gh.log. readArgLog() reads it.
  logPath: string;
  calls(): FakeGhCall[];
  // The argument lists that had no answer.
  unanswered(): string[][];
  // Throws when unanswered() is not empty. fakeGh() registers it with answerChecks().
  assertAnswered(): void;
}

// Writes a fake gh into <dir>/bin with writeFakeGh(), with the log <dir>/gh.log.
// A call with no answer fails the test, also when the code under test catches the error.
// Call it in a test or in beforeEach. A second call with the same dir replaces the script and keeps the log.
export function fakeGh(
  dir: string,
  baseEnv: NodeJS.ProcessEnv,
  answers: readonly FakeGhAnswer[],
  options: { logEnv?: readonly string[] } = {},
): FakeGh {
  const binDir = join(dir, "bin");
  const logPath = join(dir, "gh.log");
  const logEnv = options.logEnv ?? [];
  writeFakeGh(binDir, logPath, answers, logEnv);
  const checks = answerChecks("gh", logPath);
  const fake: FakeGh = {
    env: { ...baseEnv, PATH: binDir },
    logPath,
    calls: () =>
      readFakeCalls(logPath, 1, logEnv).map((call) => ({ args: call.args, ghToken: call.leading[0], env: call.env })),
    unanswered: checks.unanswered,
    assertAnswered: checks.assertAnswered,
  };
  return fake;
}

// The query of readGithubBlockers(). It is a literal, so that the test checks the query on its own.
const BLOCKERS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { number state repository { nameWithOwner } }
      }
    }
  }
}`;

// The call of readGithubBlockers(). Owner, name and cursor go as strings (-f), the number as an Int (-F).
// The first page has no cursor argument.
export const blockersGraphqlArgs = (owner: string, name: string, number: string, cursor?: string) => [
  "api",
  "graphql",
  "-f",
  `query=${BLOCKERS_QUERY}`,
  "-f",
  `owner=${owner}`,
  "-f",
  `name=${name}`,
  "-F",
  `number=${number}`,
  ...(cursor === undefined ? [] : ["-f", `cursor=${cursor}`]),
];

// One blocker node, as GitHub gives it.
export const blockersNode = (number: number, state: string, nameWithOwner: string) => ({
  number,
  state,
  repository: { nameWithOwner },
});

// The JSON that gh prints for one page of blockers.
export function blockersPageJson(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
): string {
  return JSON.stringify({ data: { repository: { issue: { blockedBy: { pageInfo, nodes } } } } });
}

// The answer of the blockers read of an issue. A blocker without a project is in the project of the issue.
export function githubBlockersAnswer(issue: {
  project: string;
  number: number;
  blockers?: readonly { number: number; state: "OPEN" | "CLOSED"; project?: string }[];
}): FakeGhAnswer {
  const [owner, name] = issue.project.split("/");
  return {
    args: blockersGraphqlArgs(owner, name, String(issue.number)),
    stdout: blockersPageJson(
      (issue.blockers ?? []).map((blocker) =>
        blockersNode(blocker.number, blocker.state, blocker.project ?? issue.project),
      ),
    ),
  };
}

// The argument lists of the calls of gh that read blockers (api graphql), in order.
export function blockerReadCalls(gh: FakeGh): string[][] {
  return gh
    .calls()
    .map((call) => call.args)
    .filter(([command, verb]) => command === "api" && verb === "graphql");
}
