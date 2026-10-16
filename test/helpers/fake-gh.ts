import { join } from "node:path";
import { expect, onTestFinished } from "vitest";
import { shellQuote } from "../../src/vcs/git/ssh.js";
import { logLine, readArgLog, realCommandPath, writeFakeCommand } from "./fake-commands.js";

// One canned answer of the fake gh. args is the whole argument list. It must match exactly, in order.
// When two answers have the same args, the first one wins.
export interface FakeGhAnswer {
  args: readonly string[];
  stdout?: string; // default ""
  stderr?: string; // default ""
  exitCode?: number; // default 0
  // A signal name such as "TERM": the fake prints its output, then stops itself with this signal.
  killWith?: string;
  // The fake runs the real sleep for this many seconds before it prints its output.
  delaySeconds?: number;
}

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

const envNamePattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const signalNamePattern = /^[A-Z0-9]+$/;

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
  for (const name of logEnv) {
    if (!envNamePattern.test(name)) throw new Error(`bad env name for the fake gh: ${name}`);
  }
  const extra = ["GH_TOKEN", ...logEnv].map((name) => `"\${${name}+set:$${name}}"`);
  const body = [logLine(logPath, extra)];
  for (const answer of answers) {
    const conditions = [
      `[ $# -eq ${answer.args.length} ]`,
      ...answer.args.map((arg, index) => `[ "\${${index + 1}}" = ${shellQuote(arg)} ]`),
    ];
    const lines = [`if ${conditions.join(" && ")}; then`];
    if (answer.delaySeconds !== undefined) {
      if (!/^\d+(\.\d+)?$/.test(String(answer.delaySeconds))) {
        throw new Error(`bad delay for the fake gh: ${answer.delaySeconds}`);
      }
      lines.push(`  ${shellQuote(realCommandPath("sleep"))} ${answer.delaySeconds}`);
    }
    lines.push(
      `  printf '%s' ${shellQuote(answer.stdout ?? "")}`,
      `  printf '%s' ${shellQuote(answer.stderr ?? "")} >&2`,
    );
    if (answer.killWith !== undefined) {
      if (!signalNamePattern.test(answer.killWith)) {
        throw new Error(`bad signal name for the fake gh: ${answer.killWith}`);
      }
      lines.push(`  kill -${answer.killWith} $$`);
    }
    lines.push(`  exit ${answer.exitCode ?? 0}`, "fi");
    body.push(...lines);
  }
  body.push(logLine(`${logPath}.unanswered`), "printf 'fake gh: no answer for: %s\\n' \"$*\" >&2", "exit 99");
  writeFakeCommand(binDir, "gh", body.join("\n"));
}

export interface FakeGh {
  // baseEnv with PATH=<dir>/bin and nothing else on PATH.
  env: NodeJS.ProcessEnv;
  // <dir>/gh.log. readArgLog() reads it.
  logPath: string;
  calls(): FakeGhCall[];
  // The argument lists that had no answer.
  unanswered(): string[][];
  // Throws when unanswered() is not empty. fakeGh() registers it with onTestFinished.
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
  const unanswered = () => readArgLog(`${logPath}.unanswered`);
  const fake: FakeGh = {
    env: { ...baseEnv, PATH: binDir },
    logPath,
    calls: () =>
      readArgLog(logPath).map((items) => {
        const fromLog = (item: string) => (item === "" ? undefined : item.slice("set:".length));
        return {
          args: items.slice(1 + logEnv.length),
          ghToken: fromLog(items[0]),
          env: Object.fromEntries(logEnv.map((name, index) => [name, fromLog(items[1 + index])])),
        };
      }),
    unanswered,
    assertAnswered: () => expect(unanswered(), "gh calls with no answer").toEqual([]),
  };
  onTestFinished(() => fake.assertAnswered());
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
