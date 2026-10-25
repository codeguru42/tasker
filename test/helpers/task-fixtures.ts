import { existsSync, rmSync } from "node:fs";
import { delimiter, dirname } from "node:path";
import { expect, onTestFinished } from "vitest";
import { accept } from "../../src/commands/accept.js";
import { merge } from "../../src/commands/merge.js";
import { start } from "../../src/commands/start.js";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import type { IssueRef } from "../../src/issue-key/ref.js";
import { loadConfig } from "../../src/config/load.js";
import type { Config } from "../../src/config/schema.js";
import { canonicalPath } from "../../src/real-path.js";
import type { PlanAnswer } from "../../src/plan/answer.js";
import { transitionTask, type TaskState, type TransitionDetail } from "../../src/state/machine.js";
import type {
  NewReview,
  NewSession,
  PlanRevision,
  Review,
  StoredSession,
  Task,
  TaskEvent,
  TaskStore,
  VerifyRun,
} from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { listWorktrees } from "../../src/vcs/git/worktree.js";
import { runCommand } from "./cli.js";
import { failureOf } from "./errors.js";
import { validConfig, writeDataRootConfig } from "./config.js";
import { useFakeSandboxBin } from "./fake-commands.js";
import { type FakeClaude, type FakeClaudeControl, useFakeClaude, useFakeClaudeOnPath } from "./fake-claude.js";
import {
  type FakeGh,
  type FakeGhAnswer,
  fakeGh,
  ghTokenAnswer,
  githubBlockersAnswer,
  githubIssueAnswer,
  githubWriteAnswer,
} from "./fake-gh.js";
import {
  GIT_TEST_IDENTITY,
  type GitOrigin,
  commitInWorktree,
  gitOutput,
  landBranchOnOriginMain,
  localBranches,
  makeProviderFixture,
  taskNames,
} from "./git.js";
import { recordTestPlanRevision, seedPlanSession, validPlanAnswer } from "./plan.js";
import {
  type SeedTask,
  dayAt,
  eventsOf,
  latestTaskOf,
  lockNames,
  pauseRefineFrom,
  pauseTaskFrom,
  seedReview,
  seedTasks,
  seedVerifyRun,
  withDataRootStore,
} from "./store.js";
import { useProcessEnv, useTempHome } from "./temp.js";

export interface SeededTaskFixture {
  dataRoot: string;
  config: Config;
  claude: FakeClaude;
  repoKey: string;
  key: string;
}

// The setup of a test that needs one seeded task and no started one: useStartFixture(), a fake claude with control
// first on PATH (see useFakeClaudeOnPath()), then the task of issue 5 in the repo of the fixture, seeded with seed (see
// seedTasks) at dayAt(1). Call it inside a test.
export async function useSeededTask(
  control: FakeClaudeControl,
  seed: Omit<SeedTask, "issueKey" | "repoKey" | "at">,
): Promise<SeededTaskFixture> {
  const fixture = await useStartFixture();
  const claude = useFakeClaudeOnPath(control);
  const key = `${fixture.repoKey}#5`;
  seedTasks(fixture.dataRoot, [{ issueKey: key, repoKey: fixture.repoKey, at: dayAt(1), ...seed }]);
  return { dataRoot: fixture.dataRoot, config: fixture.config, claude, repoKey: fixture.repoKey, key };
}

// The repo option of useStartFixture for the github tracker of the fixture: the provider and the account, then keys.
// A test names only the keys that differ, for example trackerRepo({ updateOnStart: true }).
export function trackerRepo(keys: Record<string, unknown>): { issueTracker: Record<string, unknown> } {
  return { issueTracker: { provider: "github", account: "codeguru42", ...keys } };
}

const FIXTURE_REPO = "codeguru42/tasker";

// The tracker writes of issue 5 of the fixture repo. The labels are the ones that the tests give to trackerRepo
// (inProgressLabel "in progress", doneLabel "done"), and the assignee is the default @me.
const FIXTURE_TRACKER_WRITES = {
  assign: { verb: "edit", rest: ["--add-assignee", "@me"] },
  inProgress: { verb: "edit", rest: ["--add-label", "in progress"] },
  clearInProgress: { verb: "edit", rest: ["--remove-label", "in progress"] },
  doneLabel: { verb: "edit", rest: ["--add-label", "done"] },
  close: { verb: "close", rest: ["--reason", "completed"] },
} as const;

export type FixtureTrackerWrite = keyof typeof FIXTURE_TRACKER_WRITES;

// The argument list that trackerWriteCalls logs for a tracker write of issue 5 of the fixture repo.
export function fixtureTrackerCall(write: FixtureTrackerWrite): string[] {
  const { verb, rest } = FIXTURE_TRACKER_WRITES[write];
  return ["issue", verb, "5", "-R", FIXTURE_REPO, ...rest];
}

// The fake gh answer for a tracker write of issue 5 of the fixture repo. A failure gives stderr and exitCode.
export function fixtureTrackerAnswer(
  write: FixtureTrackerWrite,
  failure: { stderr?: string; exitCode?: number } = {},
): FakeGhAnswer {
  const { verb, rest } = FIXTURE_TRACKER_WRITES[write];
  return githubWriteAnswer({ project: FIXTURE_REPO, number: 5, verb, rest: [...rest], ...failure });
}

export interface StartFixture {
  origin: GitOrigin;
  dataRoot: string;
  configPath: string;
  gh: FakeGh;
  repoKey: string;
  config: Config;
}

// The answers of the fake gh of a start fixture, in order: the token, the read of each issue, the extra answers,
// then the blockers read of each issue. The default issue is number 5 of repoKey.
function startGhAnswers(
  repoKey: string,
  options: { issues?: Parameters<typeof githubIssueAnswer>[0][]; ghAnswers?: readonly FakeGhAnswer[] },
): FakeGhAnswer[] {
  const issues = options.issues ?? [{ project: repoKey, number: 5 }];
  return [
    ghTokenAnswer("codeguru42", "gho_test"),
    ...issues.map(githubIssueAnswer),
    ...(options.ghAnswers ?? []),
    ...issues.map(({ project, number }) => githubBlockersAnswer({ project, number })),
  ];
}

// Replaces the answers of the fake gh of a start fixture. The options are the issues and ghAnswers options of
// useStartFixture, with the same answer order. The log of the calls stays, and the PATH stays valid.
export function replaceStartGh(
  fixture: Pick<StartFixture, "gh" | "repoKey">,
  options: { issues?: Parameters<typeof githubIssueAnswer>[0][]; ghAnswers?: readonly FakeGhAnswer[] },
): void {
  fakeGh(dirname(fixture.gh.logPath), {}, startGhAnswers(fixture.repoKey, options));
}

// The setup of the tests of tasker start: a local origin with main, one repo codeguru42/tasker that
// uses it as the remote, and a fake gh that answers the token call and the read of each issue.
// The default issue is codeguru42/tasker#5. A key of options.repo that is undefined is removed.
// options.limits changes the limits of the configuration file.
// options.ghAnswers adds answers to the fake gh, after the token and issue answers.
// Last, each issue gets an answer of the blockers read with no blockers. An answer of
// options.ghAnswers for the same read comes first, so it wins.
// The fake gh comes first on the PATH, so the real gh never runs and git still runs.
// Call it inside a test. After the test, it removes the folders and restores the env.
export async function useStartFixture(
  options: {
    issues?: Parameters<typeof githubIssueAnswer>[0][];
    repo?: Record<string, unknown>;
    remote?: string;
    // Limits of the configuration to change, for example { planTimeoutMin: 0.05 }.
    limits?: Record<string, number>;
    // More answers of the fake gh. They come after the token and issue answers.
    ghAnswers?: readonly FakeGhAnswer[];
  } = {},
): Promise<StartFixture> {
  const provider = await makeProviderFixture();
  onTestFinished(() => provider.remove());
  const { origin } = provider;
  const repoKey = FIXTURE_REPO;
  const raw = validConfig();
  const repo: Record<string, unknown> = Object.fromEntries(
    Object.entries({
      ...raw.repos.tasker,
      remote: options.remote ?? origin.path,
      defaultBaseBranch: "main",
      ...options.repo,
    }).filter(([, value]) => value !== undefined),
  );
  raw.repos = { [repoKey]: repo };
  raw.limits = { ...raw.limits, ...options.limits };
  const written = writeDataRootConfig(raw);
  onTestFinished(() => rmSync(written.dir, { recursive: true, force: true }));
  const gh = fakeGh(written.dir, {}, startGhAnswers(repoKey, options));
  useProcessEnv({
    TASKER_CONFIG: written.path,
    PATH: `${String(gh.env.PATH)}${delimiter}${String(process.env.PATH)}`,
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
// its clone, branch and worktree. args are more arguments of tasker start. It makes no assertion. The fake gh of the fixture must answer the read of the
// issue (see the issues option of useStartFixture).
export async function startIssueTask(
  fixture: StartFixture,
  number: number,
  ...args: string[]
): Promise<Pick<StartedTask, "key" | "result" | "branch" | "worktree" | "clone">> {
  const key = `codeguru42/tasker#${number}`;
  const result = await runCommand(start, "start", key, ...args);
  const { clone, worktrees } = repoPaths(fixture.dataRoot, fixture.repoKey);
  const { branch, worktree } = taskNames(worktrees, number, `Issue ${number}`);
  return { key, result, branch, worktree, clone };
}

// The ref of the started task, with the short ref of issue 5.
export function taskRefOf(started: Pick<StartedTask, "key" | "repoKey">): IssueRef {
  return { key: started.key, repoKey: started.repoKey, shortRef: githubShortRef("5") };
}

// Calls call, expects it to throw a message that starts with message, and expects that the state and the events
// of the latest task did not change. It gives the error.
export async function expectRefusedWithoutChange(
  started: Pick<StartedTask, "dataRoot" | "key">,
  call: () => Promise<unknown>,
  message: string,
): Promise<Error> {
  const { dataRoot, key } = started;
  const state = latestTaskOf(dataRoot, key).state;
  const events = eventsOf(dataRoot, key);

  const error = await failureOf(call(), Error);

  expect(error.message.startsWith(message)).toBe(true);
  expect(latestTaskOf(dataRoot, key).state).toBe(state);
  expect(eventsOf(dataRoot, key)).toEqual(events);
  return error;
}

// Runs run, expects exit code 1, no stdout and the error on stderr (the exact text, or a match of the RegExp), and
// expects that the state and the events of the latest task of key did not change.
export async function expectCommandRefused(
  target: Pick<StartedTask, "dataRoot" | "key">,
  run: () => Promise<{ code: number; out: string; err: string }>,
  error: string | RegExp,
): Promise<void> {
  const { dataRoot, key } = target;
  const state = latestTaskOf(dataRoot, key).state;
  const events = eventsOf(dataRoot, key);

  const result = await run();

  expect(result.code).toBe(1);
  expect(result.out).toBe("");
  if (typeof error === "string") expect(result.err).toBe(error);
  else expect(result.err).toMatch(error);
  expect(latestTaskOf(dataRoot, key).state).toBe(state);
  expect(eventsOf(dataRoot, key)).toEqual(events);
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
  const state = withDataRootStore(
    started.dataRoot,
    (store) => store.findLatestTask(started.repoKey, started.key)?.state,
  );
  const listedPaths = (await listWorktrees({ clone, env })).map((entry) => entry.path);
  return {
    state,
    worktree: existsSync(started.worktree),
    listed: listedPaths.includes(canonicalPath(started.worktree)),
    branch: (await localBranches(clone, env)).includes(`refs/heads/${started.branch}`),
  };
}

// The tip of the task branch in the clone: the exact ref refs/heads/<branch>, read with git show-ref and not from HEAD.
export async function taskBranchTipOf(fixture: Pick<WorkReviewTask, "clone" | "env" | "task">): Promise<string> {
  const { branch } = fixture.task;
  if (branch === null) throw new Error("the task has no branch");
  return gitOutput(
    { gitDir: fixture.clone },
    fixture.env,
    "show-ref",
    "--verify",
    "--hash",
    "--",
    `refs/heads/${branch}`,
  );
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
  const taskRepo = started.config.repos[started.repoKey];
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
// It does not start a run. The fake bwrap and socat come with the fake claude (see useFakeClaudeOnPath()).
// Call it inside a test.
export async function usePlanFixture(
  control: FakeClaudeControl,
  options?: Parameters<typeof useStartFixture>[0],
): Promise<PlanFixture> {
  const started = await useStartedTask(options);
  const claude = useFakeClaudeOnPath(control);
  return { started, claude };
}

// Gives the task of the fixture a plan session, then pauses it with the given step. Returns the paused task.
function pausePlanFixtureWith(fixture: PlanFixture, pause: (store: TaskStore, taskId: number) => Task): Task {
  const { dataRoot, repoKey, key } = fixture.started;
  return withDataRootStore(dataRoot, (store) => {
    const task = store.findLatestTask(repoKey, key)!;
    seedPlanSession(store, task.id);
    return pause(store, task.id);
  });
}

// Gives the task of the fixture a plan session and pauses it from origin. data replaces the default detail of the pause
// (see pauseTaskFrom). Returns the paused task.
export function pausePlanFixtureTask(
  fixture: PlanFixture,
  origin: TaskState,
  pause: "quota_blocked" | "awaiting_quota_approval" | "interrupted",
  data?: Parameters<typeof pauseTaskFrom>[4],
): Task {
  return pausePlanFixtureWith(fixture, (store, taskId) => pauseTaskFrom(store, taskId, origin, pause, data));
}

// Gives the task of the fixture a plan session and pauses it after a refine from refineOrigin (see pauseRefineFrom).
// Returns the paused task.
export function pausePlanFixtureRefine(
  fixture: PlanFixture,
  refineOrigin: TaskState,
  pause: "quota_blocked" | "awaiting_quota_approval" | "interrupted",
  data?: TransitionDetail,
): Task {
  return pausePlanFixtureWith(fixture, (store, taskId) =>
    pauseRefineFrom(store, taskId, refineOrigin, pause, undefined, data),
  );
}

export interface RefineFixture extends PlanFixture {
  task: Task;
  revision: PlanRevision;
  session: StoredSession;
}

// The setup of the tests of tasker refine: usePlanFixture(control, { repo, limits }), then the task moves to planning
// and gets revision v1 with its plan file (the answer of options.answer on top of validPlanAnswer), so it is in
// awaiting_plan_review, and a plan session (options.session on top of seedPlanSession). Call it inside a test.
export async function useRefineFixture(
  control: FakeClaudeControl,
  options: {
    repo?: Record<string, unknown>;
    limits?: Record<string, number>;
    answer?: Partial<PlanAnswer>;
    session?: Partial<NewSession>;
  } = {},
): Promise<RefineFixture> {
  const fixture = await usePlanFixture(control, { repo: options.repo, limits: options.limits });
  const { dataRoot, repoKey, key } = fixture.started;
  return withDataRootStore(dataRoot, (store) => {
    const found = store.findLatestTask(repoKey, key)!;
    transitionTask(store, found.id, "planning");
    const task = recordTestPlanRevision(store, dataRoot, found.id, { answer: validPlanAnswer(options.answer) });
    const revision = store.getPlanRevision(task.id, 1)!;
    const session = seedPlanSession(store, task.id, options.session);
    return { ...fixture, task, revision, session };
  });
}

export interface ReviewedRefineFixture extends RefineFixture {
  review: Review | undefined;
  verifyRun: VerifyRun | undefined;
}

// useRefineFixture, then v1 is approved, a passed verify run is seeded (unless options.verifyRun is false) and a review
// is seeded (options.review on top of the defaults of seedReview), so the task is in options.state (reviewed by
// default). With review: null, no review is seeded and the task goes to options.state with no review.
// Call it inside a test.
export async function useReviewedRefineFixture(
  control: FakeClaudeControl,
  options: Parameters<typeof useRefineFixture>[1] & {
    verifyRun?: boolean;
    review?: Partial<Omit<NewReview, "number">> | null;
    state?: "reviewed" | "awaiting_work_review";
  } = {},
): Promise<ReviewedRefineFixture> {
  const { verifyRun, review, state = "reviewed", ...refineOptions } = options;
  const fixture = await useRefineFixture(control, refineOptions);
  return withDataRootStore(fixture.started.dataRoot, (store) => {
    store.approvePlanRevision(fixture.task.id, 1, "approved");
    const run = verifyRun === false ? undefined : seedVerifyRun(store, fixture.started.dataRoot, fixture.task);
    const seeded = review === null ? undefined : seedReview(store, fixture.task.id, review ?? {}, state);
    if (review === null) store.endRun(fixture.task.id, state);
    return { ...fixture, task: store.getTask(fixture.task.id)!, review: seeded, verifyRun: run };
  });
}

export interface ExecuteFixture extends PlanFixture {
  task: Task;
  revision: PlanRevision;
  config: Config;
  env: NodeJS.ProcessEnv;
}

// The setup of the tests of tasker execute: usePlanFixture(control, { repo, limits }), then the task moves to planning, gets revision v1 with its plan file (the answer of options.answer on top
// of validPlanAnswer) and v1 is approved, so the task is in approved with v1 pinned. config is the configuration of
// the started task and env is process.env after the stubs. Call it inside a test.
export async function useExecuteFixture(
  control: FakeClaudeControl,
  options: {
    repo?: Record<string, unknown>;
    limits?: Record<string, number>;
    answer?: Partial<PlanAnswer>;
  } = {},
): Promise<ExecuteFixture> {
  const fixture = await usePlanFixture(control, { repo: options.repo, limits: options.limits });
  const { dataRoot, repoKey, key } = fixture.started;
  return withDataRootStore(dataRoot, (store) => {
    const found = store.findLatestTask(repoKey, key)!;
    transitionTask(store, found.id, "planning");
    recordTestPlanRevision(store, dataRoot, found.id, { answer: validPlanAnswer(options.answer) });
    const task = store.approvePlanRevision(found.id, 1, "approved");
    const revision = store.getPlanRevision(task.id, 1)!;
    return { ...fixture, task, revision, config: fixture.started.config, env: process.env };
  });
}

// Expects that no run of the assistant started: no call of the fake claude and no lock row.
export function expectNoAssistantRun(fixture: { claude: FakeClaude; started: Pick<StartedTask, "dataRoot"> }): void {
  expect(fixture.claude.calls()).toEqual([]);
  expect(lockNames(fixture.started.dataRoot)).toEqual([]);
}

// The states from workspace_ready to awaiting_work_review, in the order of the main path.
export const TO_WORK_REVIEW = [
  "planning",
  "awaiting_plan_review",
  "approved",
  "executing",
  "executed",
  "verifying",
  "awaiting_work_review",
] as const;

// Moves the task id through states on the open store, in order, with transitionTask, and gives the task after the last
// move.
export function moveTaskThrough(store: TaskStore, id: number, states: readonly TaskState[]): Task {
  for (const state of states) transitionTask(store, id, state);
  return store.getTask(id)!;
}

// Moves the latest task of key in the repo through states, in order, and gives the task after the last move.
function walkTask(dataRoot: string, repoKey: string, key: string, states: readonly TaskState[]): Task {
  return withDataRootStore(dataRoot, (store) => {
    return moveTaskThrough(store, store.findLatestTask(repoKey, key)!.id, states);
  });
}

export interface WorkReviewTask extends StartFixture {
  key: string;
  // The task in awaiting_work_review, with its worktree path and branch.
  task: Task;
  clone: string;
  env: NodeJS.ProcessEnv;
}

// Appends a base event { base, revision, source: "explicit" } to the task of the fixture, in a store of its own.
export function appendBaseEvent(
  fixture: Pick<WorkReviewTask, "dataRoot" | "task">,
  base: string,
  revision: string,
): TaskEvent {
  return withDataRootStore(fixture.dataRoot, (store) =>
    store.appendEvent(fixture.task.id, "base", { base, revision, source: "explicit" }),
  );
}

// Runs useStartFixture(options), starts the task of issue 5 with startTaskWithCommits and one commit for each file of
// files (default ["work.txt"]), then moves the task through the states to awaiting_work_review. It throws when the
// start fails. It sets the git identity of the clone to GIT_TEST_IDENTITY through vcs.config, and a vcs key of
// options.repo replaces this default. Call it inside a test.
export async function useWorkReviewTask(
  options: Parameters<typeof useStartFixture>[0] & { files?: readonly string[] } = {},
): Promise<WorkReviewTask> {
  const { files = ["work.txt"], ...fixtureOptions } = options;
  const fixture = await useStartFixture({
    ...fixtureOptions,
    repo: {
      vcs: { provider: "git", config: { authorName: GIT_TEST_IDENTITY.name, authorEmail: GIT_TEST_IDENTITY.email } },
      ...fixtureOptions.repo,
    },
  });
  const key = `${fixture.repoKey}#5`;
  await startTaskWithCommits(fixture, 5, files);
  const task = walkTask(fixture.dataRoot, fixture.repoKey, key, TO_WORK_REVIEW);
  return { ...fixture, key, task, clone: repoPaths(fixture.dataRoot, fixture.repoKey).clone, env: fixture.origin.env };
}

export interface StackedTasks extends StartFixture {
  clone: string;
  env: NodeJS.ProcessEnv;
  // The parent, issue 5, in awaiting_work_review with the commit parent.txt.
  parent: { key: string; task: Task; branch: string; worktree: string };
  // The stacked task, issue 6, in executed with the commit stacked.txt. Its base is the branch of the parent.
  stacked: { key: string; task: Task; branch: string; worktree: string };
}

// Runs useStartFixture with the issues 5 and 6, starts the task of issue 5 with one commit parent.txt and moves it to
// awaiting_work_review. Then it starts the task of issue 6 with --base refs/heads/<branch of the parent>, commits
// stacked.txt and moves it to executed. It throws when a start fails. It sets the git identity of the clone to
// GIT_TEST_IDENTITY through vcs.config, and a vcs key of options.repo replaces this default. Call it inside a test.
export async function useStackedTasks(options: Parameters<typeof useStartFixture>[0] = {}): Promise<StackedTasks> {
  const fixture = await useStartFixture({
    ...options,
    issues: [
      { project: "codeguru42/tasker", number: 5 },
      { project: "codeguru42/tasker", number: 6 },
    ],
    repo: {
      vcs: { provider: "git", config: { authorName: GIT_TEST_IDENTITY.name, authorEmail: GIT_TEST_IDENTITY.email } },
      ...options.repo,
    },
  });
  const { repoKey, dataRoot } = fixture;
  const parentStart = await startIssueTask(fixture, 5);
  if (parentStart.result.code !== 0)
    throw new Error(`tasker start failed for ${parentStart.key}: ${parentStart.result.err}`);
  await commitInWorktree(parentStart.worktree, fixture.origin.env, { file: "parent.txt" });
  const parent = walkTask(dataRoot, repoKey, parentStart.key, TO_WORK_REVIEW);
  const stackedStart = await startIssueTask(fixture, 6, "--base", `refs/heads/${parentStart.branch}`);
  if (stackedStart.result.code !== 0) {
    throw new Error(`tasker start failed for ${stackedStart.key}: ${stackedStart.result.err}`);
  }
  await commitInWorktree(stackedStart.worktree, fixture.origin.env, { file: "stacked.txt" });
  const stacked = walkTask(dataRoot, repoKey, stackedStart.key, TO_WORK_REVIEW.slice(0, 5));
  return {
    ...fixture,
    clone: parentStart.clone,
    env: fixture.origin.env,
    parent: { key: parentStart.key, task: parent, branch: parentStart.branch, worktree: parentStart.worktree },
    stacked: { key: stackedStart.key, task: stacked, branch: stackedStart.branch, worktree: stackedStart.worktree },
  };
}

// Makes the head of the branch of the parent the head of main on origin, as a landing outside tasker does, then moves
// the task of the parent through states.
export async function landParent(fixture: StackedTasks, states: readonly TaskState[]): Promise<void> {
  await landBranchOnOriginMain({
    origin: fixture.origin.path,
    clone: fixture.clone,
    branch: fixture.parent.branch,
    env: fixture.env,
  });
  withDataRootStore(fixture.dataRoot, (store) => moveTaskThrough(store, fixture.parent.task.id, states));
}

export interface MovedBaseTask extends WorkReviewTask {
  // The tip of main on origin after the move. The task branch does not contain it.
  baseTip: string;
}

// Runs useWorkReviewTask(options), then adds one commit to main on origin (baseChange is the change of that commit),
// so that the base moved past the task branch. Call it inside a test.
export async function useMovedBaseTask(
  options: Parameters<typeof useWorkReviewTask>[0] & {
    baseChange?: { file?: string; content?: string; message?: string };
  } = {},
): Promise<MovedBaseTask> {
  const { baseChange, ...workOptions } = options;
  const work = await useWorkReviewTask(workOptions);
  const baseTip = await work.origin.addCommit("main", baseChange);
  return { ...work, baseTip };
}

// Seeds the task of issue 5 in accepted, with the given branch and base.
export function seedAcceptedTask(
  fixture: Pick<StartFixture, "dataRoot">,
  extra: { branch?: string; base?: string } = {},
): Task {
  return seedTasks(fixture.dataRoot, [
    { issueKey: "codeguru42/tasker#5", repoKey: "codeguru42/tasker", state: "accepted", at: dayAt(1), ...extra },
  ])[0];
}

export interface AcceptedTask extends WorkReviewTask {
  // The tip of the task branch that tasker accept recorded.
  revision: string;
}

// Runs useWorkReviewTask(options), then tasker accept for the task, and gives the task in accepted. It throws when the
// accept fails. Call it inside a test.
export async function useAcceptedTask(options?: Parameters<typeof useWorkReviewTask>[0]): Promise<AcceptedTask> {
  const work = await useWorkReviewTask(options);
  const result = await runCommand(accept, "accept", work.key, "--repo", work.repoKey);
  if (result.code !== 0) throw new Error(`tasker accept failed: ${result.err}`);
  const event = eventsOf(work.dataRoot, work.key)
    .filter((e) => e.type === "accepted")
    .at(-1);
  const revision = (event?.data as { revision?: unknown } | undefined)?.revision;
  if (typeof revision !== "string") throw new Error("tasker accept wrote no accepted event");
  return { ...work, task: latestTaskOf(work.dataRoot, work.key), revision };
}

export interface LandedTask extends AcceptedTask {
  // The stored worktree path and branch of the task.
  worktree: string;
  branch: string;
}

// Runs useAcceptedTask(options), then tasker merge for the task, and gives the task in landed. It throws when the
// merge fails. Call it inside a test.
export async function useLandedTask(options?: Parameters<typeof useWorkReviewTask>[0]): Promise<LandedTask> {
  const accepted = await useAcceptedTask(options);
  const result = await runCommand(merge, "merge", accepted.key, "--repo", accepted.repoKey);
  if (result.code !== 0) throw new Error(`tasker merge failed: ${result.err}`);
  const task = latestTaskOf(accepted.dataRoot, accepted.key);
  if (task.worktreePath === null || task.branch === null) throw new Error("the landed task has no worktree or branch");
  return { ...accepted, task, worktree: task.worktreePath, branch: task.branch };
}

// Makes the head of the task branch the head of main on origin, as a push by someone else would.
export async function landAcceptedTask(
  fixture: Pick<AcceptedTask, "origin" | "clone" | "task" | "env">,
): Promise<void> {
  await landBranchOnOriginMain({
    origin: fixture.origin.path,
    clone: fixture.clone,
    branch: String(fixture.task.branch),
    env: fixture.env,
  });
}

export interface ReviewFixture extends WorkReviewTask {
  claude: FakeClaude;
}

// The setup of the tests of tasker review: useWorkReviewTask(options), then a fake claude with the control, first on
// PATH (see useFakeClaudeOnPath()). Call it inside a test.
export async function useReviewFixture(
  control: FakeClaudeControl,
  options?: Parameters<typeof useWorkReviewTask>[0],
): Promise<ReviewFixture> {
  const work = await useWorkReviewTask(options);
  const claude = useFakeClaudeOnPath(control);
  return { ...work, claude };
}

export interface VerifyFixture {
  started: StartedTask;
  // The task in executed, with its worktree path.
  task: Task;
  config: Config;
  env: NodeJS.ProcessEnv;
}

// The setup of the tests of tasker verify: a started task with the verify commands in its repo and the limits in
// the configuration, moved through the states to executed. It throws when the start failed. Call it inside a test.
export async function useVerifyFixture(options: {
  commands: string[];
  limits?: Record<string, number>;
}): Promise<VerifyFixture> {
  const started = await useStartedTask({
    repo: { verify: { commands: options.commands, env: [] } },
    limits: options.limits,
  });
  if (started.result.code !== 0) throw new Error(`tasker start failed: ${started.result.err}`);
  const task = walkTask(started.dataRoot, started.repoKey, started.key, TO_WORK_REVIEW.slice(0, 5));
  return { started, task, config: started.config, env: started.env };
}
