import {
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, onTestFinished } from "vitest";
import type { AssistantEvent, RunInput } from "../src/assistant/provider.js";
import { start } from "../src/commands/start.js";
import { loadConfig } from "../src/config/load.js";
import type { Config } from "../src/config/schema.js";
import { canonicalPath } from "../src/real-path.js";
import type { PlanAnswer } from "../src/plan/answer.js";
import { transitionTask, type TaskState } from "../src/state/machine.js";
import { recordPlanRevision } from "../src/store/plan-file.js";
import {
  type ExecuteTodoState,
  type NewPlanRevision,
  type NewSession,
  type PlanRevision,
  type StoredSession,
  type Task,
  type TaskStore,
} from "../src/store/store.js";
import { repoPaths } from "../src/vcs/git/repo-paths.js";
import { shellQuote } from "../src/vcs/git/ssh.js";
import { listWorktrees } from "../src/vcs/git/worktree.js";
import { runCommand } from "./helpers/cli.js";
import { type GitOrigin, commitInWorktree, localBranches, makeProviderFixture, taskNames } from "./helpers/git.js";
import { logLine, readArgLog, realCommandPath, useFakeSandboxBin, writeFakeCommand } from "./helpers/fake-commands.js";
import { useThreeRepoDataRoot, validConfig, writeDataRootConfig } from "./helpers/config.js";
import { dayAt, type SeedTask, seedTasks, withDataRootStore } from "./helpers/store.js";
import { useProcessEnv, useTempDir, useTempHome } from "./helpers/temp.js";

export * from "./helpers/cli.js";
export * from "./helpers/config.js";
export * from "./helpers/fake-commands.js";
export * from "./helpers/fake-ssh.js";
export * from "./helpers/git.js";
export * from "./helpers/errors.js";
export * from "./helpers/processes.js";
export * from "./helpers/source-scan.js";
export * from "./helpers/store.js";
export * from "./helpers/temp.js";

export interface StartFixture {
  origin: GitOrigin;
  dataRoot: string;
  configPath: string;
  gh: FakeGh;
  repoKey: string;
  config: Config;
}

// The setup of the tests of tasker start: a local origin with main, one repo codeguru42/tasker that
// uses it as the remote, and a fake gh that answers the token call and the read of each issue.
// The default issue is codeguru42/tasker#5. A key of options.repo that is undefined is removed.
// The fake gh comes first on the PATH, so the real gh never runs and git still runs.
// Call it inside a test. After the test, it removes the folders and restores the env.
export async function useStartFixture(
  options: {
    issues?: Parameters<typeof githubIssueAnswer>[0][];
    repo?: Record<string, unknown>;
    remote?: string;
  } = {},
): Promise<StartFixture> {
  const provider = await makeProviderFixture();
  onTestFinished(() => provider.remove());
  const { origin } = provider;
  const repoKey = "codeguru42/tasker";
  const raw = validConfig();
  const repo: Record<string, unknown> = {
    ...raw.repos.tasker,
    remote: options.remote ?? origin.path,
    defaultBaseBranch: "main",
    ...options.repo,
  };
  for (const [name, value] of Object.entries(repo)) {
    if (value === undefined) delete repo[name];
  }
  raw.repos = { [repoKey]: repo };
  const written = writeDataRootConfig(raw);
  onTestFinished(() => rmSync(written.dir, { recursive: true, force: true }));
  const gh = fakeGh(written.dir, {}, [
    ghTokenAnswer("codeguru42", "gho_test"),
    ...(options.issues ?? [{ project: repoKey, number: 5 }]).map(githubIssueAnswer),
  ]);
  useProcessEnv({
    TASKER_CONFIG: written.path,
    PATH: `${gh.env.PATH}${delimiter}${process.env.PATH}`,
  });
  return { origin, dataRoot: written.dataRoot, configPath: written.path, gh, repoKey, config: loadConfig() };
}

export interface StartedTask extends StartFixture {
  key: string;
  // The result of tasker start for the key.
  result: { code: number; out: string; err: string };
  branch: string;
  worktree: string;
  clone: string;
  env: NodeJS.ProcessEnv;
}

// Runs tasker start for codeguru42/tasker#<number> in the fixture and gives the key, the result and the names of
// its clone, branch and worktree. It makes no assertion. The fake gh of the fixture must answer the read of the
// issue (see the issues option of useStartFixture).
export async function startIssueTask(
  fixture: StartFixture,
  number: number,
): Promise<Pick<StartedTask, "key" | "result" | "branch" | "worktree" | "clone">> {
  const key = `codeguru42/tasker#${number}`;
  const result = await runCommand(start, "start", key);
  const { clone, worktrees } = repoPaths(fixture.dataRoot, fixture.repoKey);
  const { branch, worktree } = taskNames(worktrees, number, `Issue ${number}`);
  return { key, result, branch, worktree, clone };
}

// Runs useStartFixture(options), then tasker start for issue 5. It makes no assertion, so a test
// with a failing bootstrap can use it. Call it inside a test.
export async function useStartedTask(options: Parameters<typeof useStartFixture>[0] = {}): Promise<StartedTask> {
  const fixture = await useStartFixture(options);
  return { ...fixture, ...(await startIssueTask(fixture, 5)), env: fixture.origin.env };
}

// Starts the task of codeguru42/tasker#<number> in the fixture with startIssueTask, then commits each file of files
// on its task branch, one commit each. It throws when tasker start fails.
export async function startTaskWithCommits(
  fixture: StartFixture,
  number: number,
  files: readonly string[],
): Promise<Task> {
  const { key, result, worktree } = await startIssueTask(fixture, number);
  if (result.code !== 0) throw new Error(`tasker start failed for ${key}: ${result.err}`);
  for (const file of files) await commitInWorktree(worktree, fixture.origin.env, { file });
  return withDataRootStore(fixture.dataRoot, (store) => store.findLatestTask(fixture.repoKey, key)!);
}

// What a test compares before and after a command: the state of the latest task, whether the
// worktree folder exists, whether git lists the worktree, and whether the task branch exists.
export async function taskWorkspaceState(
  started: Pick<StartedTask, "dataRoot" | "repoKey" | "key" | "worktree" | "branch" | "clone" | "env">,
): Promise<{ state: string | undefined; worktree: boolean; listed: boolean; branch: boolean }> {
  const { clone, env } = started;
  const state = withDataRootStore(started.dataRoot, (store) => store.findLatestTask(started.repoKey, started.key)?.state);
  const listedPaths = (await listWorktrees({ clone, env })).map((entry) => entry.path);
  return {
    state,
    worktree: existsSync(started.worktree),
    listed: listedPaths.includes(canonicalPath(started.worktree)),
    branch: (await localBranches(clone, env)).includes(`refs/heads/${started.branch}`),
  };
}

export interface AssistantRunFixture {
  started: StartedTask;
  // The task, read after startRun. Its run marker belongs to this process.
  task: Task;
  config: Config;
  claude: FakeClaude;
  // The env of tasker for a run: the fake claude and the fake sandbox programs on PATH, temp folders for
  // HOME and XDG_CONFIG_HOME, and a fake GH_TOKEN and SSH_AUTH_SOCK that the child must not get.
  env: NodeJS.ProcessEnv;
}

// The setup of the tests of an assistant run: a started task (see useStartedTask()) that startRun moved to
// state, a fake claude with the control in claude, and fake bwrap and socat programs.
// limits changes keys of config.limits on a copy of the loaded configuration. Call it inside a test.
// sshKey sets the ssh key of the task repo in that copy. otherRepo adds a copy of the task repo after it, with
// its own ssh key. Both change the copy only, after the start, so provision never sees them.
export async function useAssistantRunFixture(options: {
  claude: FakeClaudeControl;
  repo?: Record<string, unknown>;
  limits?: Partial<Config["limits"]>;
  state?: string;
  sshKey?: string;
  otherRepo?: { key: string; sshKey: string };
}): Promise<AssistantRunFixture> {
  const started = await useStartedTask({ repo: options.repo });
  const claude = useFakeClaude(options.claude);
  const sandboxBin = useFakeSandboxBin();
  const task = withDataRootStore(started.dataRoot, (store) => {
    const found = store.findLatestTask(started.repoKey, started.key)!;
    return store.startRun(found.id, options.state ?? "planning");
  });
  const env: NodeJS.ProcessEnv = {
    ...started.env,
    PATH: [claude.binDir, sandboxBin, started.env.PATH].join(delimiter),
    ...useTempHome(),
    GH_TOKEN: "gho_secret",
    SSH_AUTH_SOCK: "/tmp/agent.sock",
  };
  const taskRepo = started.config.repos[started.repoKey]!;
  const withKey = (repo: typeof taskRepo, sshKey: string | undefined): typeof taskRepo =>
    sshKey === undefined ? repo : { ...repo, vcs: { provider: "git", config: { sshKey } } };
  const repos = { [started.repoKey]: withKey(taskRepo, options.sshKey) };
  if (options.otherRepo) repos[options.otherRepo.key] = withKey(taskRepo, options.otherRepo.sshKey);
  const config = {
    ...started.config,
    repos: { ...started.config.repos, ...repos },
    limits: { ...started.config.limits, ...options.limits },
  };
  return { started, task, config, claude, env };
}

export interface PlanFixture {
  started: StartedTask;
  claude: FakeClaude;
}

// The setup of the tests of tasker plan: a started task (see useStartedTask()) that stays in workspace_ready,
// and a fake claude with the control, first on PATH. HOME and XDG_CONFIG_HOME are temp folders.
// It does not start a run and it makes no fake sandbox programs. Call it inside a test.
export async function usePlanFixture(
  control: FakeClaudeControl,
  options?: Parameters<typeof useStartFixture>[0],
): Promise<PlanFixture> {
  const started = await useStartedTask(options);
  const claude = useFakeClaude(control);
  useProcessEnv({ ...useTempHome(), PATH: claude.binDir + delimiter + process.env.PATH });
  return { started, claude };
}

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
  body.push(
    logLine(`${logPath}.unanswered`),
    "printf 'fake gh: no answer for: %s\\n' \"$*\" >&2",
    "exit 99",
  );
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

// What the fake claude does (see useFakeClaude()).
export interface FakeClaudeControl {
  // The stdout lines. Each line gets a newline.
  stream?: string[];
  stderr?: string;
  exitCode?: number;
  // After the output is flushed, the fake sends this signal to itself.
  killWith?: NodeJS.Signals;
  // The wait after the output and before the exit.
  sleepMs?: number;
  // The fake ignores SIGTERM.
  ignoreSigterm?: boolean;
  // After the output, the fake keeps running until a signal stops it.
  untilStopped?: boolean;
  // Lines that the fake writes to stdout on SIGTERM. The fake then does not exit, so with untilStopped only
  // SIGKILL stops it. The lines come after the deadline of a run by construction.
  sigtermStream?: string[];
  // The answer when the only argument is --version.
  version?: { stdout: string; stderr?: string; exitCode?: number; sleepMs?: number };
  // Paths relative to the cwd of the fake. Before the output, the fake makes each one with writePlaceholder().
  // With killWith, this plays a killed claude that leaves placeholders.
  placeholders?: string[];
}

// One call that the fake claude logged.
export interface FakeClaudeCall {
  argv: string[];
  stdin: string;
  // The sorted names of the env of the fake.
  envNames: string[];
  // The JSON of the argument after --settings, parsed. It is absent when the call has no --settings.
  settings?: unknown;
}

export interface FakeClaude {
  // The folder with the claude program. Put it on PATH.
  binDir: string;
  // A minimal env that finds the fake: PATH and HOME.
  env: { PATH: string; HOME: string };
  // The calls so far, in order. It gives [] when the fake never ran.
  calls(): FakeClaudeCall[];
}

// The lines of test/fixtures/claude-streams/<name>.jsonl, with no empty last item.
export function claudeSample(name: string): string[] {
  const path = fileURLToPath(new URL(`fixtures/claude-streams/${name}.jsonl`, import.meta.url));
  return readFileSync(path, "utf8").split("\n").filter((line) => line !== "");
}

// Each line of a sample, parsed. Each call parses again, so each call gives new objects.
export function claudeSampleEvents(name: string): AssistantEvent[] {
  return claudeSample(name).map((line) => JSON.parse(line) as AssistantEvent);
}

// The events of a sample, with the last event (the result) changed by edit.
// The events come from a new parse, so the edit never reaches the sample file or a later read.
export function claudeSampleWithResult(name: string, edit: (result: AssistantEvent) => void): AssistantEvent[] {
  const events = claudeSampleEvents(name);
  edit(events.at(-1)!);
  return events;
}

// The real rate_limit_event of the sample rate-limit-warning (a capture from claude), new for each call,
// with its rate_limit_info changed by edit. A test names the changed field in its test name.
export function claudeRateLimitEvent(edit: (info: Record<string, unknown>) => void = () => {}): AssistantEvent {
  const event = claudeSampleEvents("rate-limit-warning")[0]!;
  edit(event["rate_limit_info"] as Record<string, unknown>);
  return event;
}

// The capture of claudeRateLimitEvent() with isUsingOverage true: an event that shows the start of paid usage.
// Then edit changes its rate_limit_info. A test names each field that edit changes in its test name.
export function claudeOverageEvent(edit: (info: Record<string, unknown>) => void = () => {}): AssistantEvent {
  return claudeRateLimitEvent((info) => {
    info["isUsingOverage"] = true;
    edit(info);
  });
}

export const TEST_SESSION_ID = "e5f6ebac-a40e-48af-befc-f9a7d1af4c5b";

// The id of an execute session. It differs from TEST_SESSION_ID, because a session id is unique in the whole table.
export const TEST_EXECUTE_SESSION_ID = "3c9d1a52-7b4e-4f0a-9d86-2e5a8c1b7f34";

// A run input with the defaults of the assistant provider tests, new for each call. Later tickets use it
// for each provider. A test that starts a child passes a real cwd and env.
export function runInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    sessionId: TEST_SESSION_ID,
    resume: false,
    prompt: "say hello",
    cwd: "/work",
    env: {},
    timeoutMs: 20_000,
    sessionDir: "/sessions",
    model: "haiku",
    effort: "low",
    ...overrides,
  };
}

// Makes a fake claude on a new temp folder, and removes it after the test. Call it inside a test.
// The fake gets its control only from a file, because childEnv() drops every other control name.
export function useFakeClaude(control: FakeClaudeControl): FakeClaude {
  const dir = useTempDir("tasker-fake-claude-");
  const binDir = join(dir, "bin");
  const logPath = join(dir, "calls.log");
  const controlPath = join(dir, "control.json");
  writeFileSync(controlPath, JSON.stringify({ ...control, logPath }));
  const fixture = fileURLToPath(new URL("fixtures/fake-claude.ts", import.meta.url));
  const loader = import.meta.resolve("tsx");
  writeFakeCommand(
    binDir,
    "claude",
    `exec ${[process.execPath, "--import", loader, fixture, controlPath].map(shellQuote).join(" ")} "$@"`,
  );
  return {
    binDir,
    env: { PATH: binDir, HOME: dir },
    calls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => JSON.parse(line) as FakeClaudeCall)
        : [],
  };
}

// Makes an empty file with mode 0o444, as bwrap leaves for a protected path. It lives in a fixture module
// that imports only node: modules, so that the fake claude starts fast.
export { writePlaceholder } from "./fixtures/placeholder.js";

// The questions block that show-plan and show-questions print for the one open question of validPlanAnswer.
export const OPEN_QUESTION_BLOCK =
  "questions:\n  base-branch: Which branch is the base?\n    The issue names no base branch.\n    open\n";

export function validPlanAnswer(change: Partial<PlanAnswer> = {}): PlanAnswer {
  return {
    summary: ["Add the a module and its test."],
    plan_markdown: "## Summary\n\nAdd the a module and its test, test first.\n",
    files_changed: ["src/a.ts", "test/a.test.ts"],
    todos: [
      {
        id: "write-test",
        title: "Add the a module",
        description: "Write the failing test of the a module.",
        depends_on: [],
      },
      {
        id: "make-it-pass",
        title: "Add the a module",
        description: "Write the a module so that the test passes.",
        depends_on: ["write-test"],
      },
    ],
    questions: [
      {
        id: "base-branch",
        question: "Which branch is the base?",
        context: "The issue names no base branch.",
      },
    ],
    ...change,
  };
}

// The stdout lines of a fake claude run that succeeds with answer as its structured output.
export function planAnswerStream(answer: unknown): string[] {
  return claudeSampleWithResult("json-schema", (result) => {
    result["structured_output"] = answer;
    result["result"] = JSON.stringify(answer);
  }).map((event) => JSON.stringify(event));
}

// The next plan revision of the task: a valid plan answer, unless change gives other values.
function newPlanRevision(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">>,
): NewPlanRevision {
  return {
    source: "plan",
    answer: validPlanAnswer(),
    prompt: "plan@000000000000",
    ...change,
    version: store.nextPlanVersion(taskId),
  };
}

// Inserts the next plan revision of the task with addPlanRevision, with a valid answer unless change gives one.
// It sets state (not a spawning state) with no check, so it writes the plan_revision event and no transition event.
// It writes no plan file.
export function seedPlanRevision(
  store: TaskStore,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">> = {},
  state = "awaiting_plan_review",
): PlanRevision {
  const revision = newPlanRevision(store, taskId, change);
  store.addPlanRevision(taskId, revision, state);
  return store.getPlanRevision(taskId, revision.version)!;
}

// Creates the task of seed in the store of dataRoot (see seedTasks), then inserts its plan revision v1 with files as
// its files_changed (see seedPlanRevision). The task keeps the state of seed.
export function seedTaskWithPlanFiles(dataRoot: string, seed: SeedTask, files: readonly string[]): Task {
  const [task] = seedTasks(dataRoot, [seed]);
  withDataRootStore(dataRoot, (store) =>
    seedPlanRevision(store, task.id, { answer: validPlanAnswer({ files_changed: [...files] }) }, seed.state),
  );
  return task;
}

// A task of codeguru42/tasker#5 in the repo codeguru42/tasker, in the state planning,
// in the data root of the three-repo configuration.
export function seedPlanningTask(): { dataRoot: string; task: Task } {
  const { dataRoot } = useThreeRepoDataRoot();
  const [task] = seedTasks(dataRoot, [
    { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "planning", at: dayAt(2) },
  ]);
  return { dataRoot, task };
}

// Records the next plan revision of the task with recordPlanRevision: it writes the plan file and the row,
// and moves the task to `to` with the check of the state machine.
export function recordTestPlanRevision(
  store: TaskStore,
  dataRoot: string,
  taskId: number,
  change: Partial<Omit<NewPlanRevision, "version">> = {},
  to: TaskState = "awaiting_plan_review",
): Task {
  return recordPlanRevision(store, dataRoot, taskId, newPlanRevision(store, taskId, change), to);
}

// Records v1 of the task with first. With second, it moves the task to refining and records v2.
// Each revision gets its plan file, as recordTestPlanRevision writes it.
export function recordPlanRevisions(
  dataRoot: string,
  task: Task,
  first: Partial<Omit<NewPlanRevision, "version">> = {},
  second?: Partial<Omit<NewPlanRevision, "version">>,
): void {
  withDataRootStore(dataRoot, (store) => {
    recordTestPlanRevision(store, dataRoot, task.id, first);
    if (second !== undefined) {
      transitionTask(store, task.id, "refining");
      recordTestPlanRevision(store, dataRoot, task.id, second);
    }
  });
}

// Records the execute session of a plan revision with TEST_EXECUTE_SESSION_ID and the execute model of the test
// configurations, unless the call changes them.
export function seedExecuteSession(
  store: TaskStore,
  taskId: number,
  version: number,
  change: Partial<NewSession> = {},
): StoredSession {
  return store.recordExecuteSession(taskId, version, {
    sessionId: TEST_EXECUTE_SESSION_ID,
    provider: "claude-code",
    model: "sonnet",
    effort: "medium",
    ...change,
  });
}

// Sets the state of each todo that states names, in the order of the record, with setExecuteTodoState.
export function seedExecuteTodoStates(
  store: TaskStore,
  taskId: number,
  version: number,
  states: Readonly<Record<string, ExecuteTodoState>>,
): void {
  for (const [todoId, state] of Object.entries(states)) {
    store.setExecuteTodoState(taskId, version, todoId, state);
  }
}

// Records a plan session for the task with TEST_SESSION_ID and the plan model of the test
// configurations, unless the call changes them.
export function seedPlanSession(
  store: TaskStore,
  taskId: number,
  change: Partial<NewSession> = {},
): StoredSession {
  return store.recordPlanSession(taskId, {
    sessionId: TEST_SESSION_ID,
    provider: "claude-code",
    model: "opus",
    effort: "high",
    ...change,
  });
}
