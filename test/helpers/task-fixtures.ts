import { existsSync, rmSync } from "node:fs";
import { delimiter } from "node:path";
import { expect, onTestFinished } from "vitest";
import { accept } from "../../src/commands/accept.js";
import { start } from "../../src/commands/start.js";
import { githubShortRef } from "../../src/issue-key/short-ref.js";
import type { IssueRef } from "../../src/issue-key/ref.js";
import { loadConfig } from "../../src/config/load.js";
import type { Config } from "../../src/config/schema.js";
import { canonicalPath } from "../../src/real-path.js";
import type { PlanAnswer } from "../../src/plan/answer.js";
import { transitionTask, type TaskState } from "../../src/state/machine.js";
import type { NewSession, PlanRevision, StoredSession, Task, TaskEvent, TaskStore } from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { runGit } from "../../src/vcs/git/run.js";
import { listWorktrees } from "../../src/vcs/git/worktree.js";
import { runCommand } from "./cli.js";
import { failureOf } from "./errors.js";
import { validConfig, writeDataRootConfig } from "./config.js";
import { useFakeSandboxBin } from "./fake-commands.js";
import { type FakeClaude, type FakeClaudeControl, useFakeClaude, useFakeClaudeOnPath } from "./fake-claude.js";
import { type FakeGh, fakeGh, ghTokenAnswer, githubIssueAnswer } from "./fake-gh.js";
import { type GitOrigin, commitInWorktree, localBranches, makeProviderFixture, taskNames } from "./git.js";
import { recordTestPlanRevision, seedPlanSession, validPlanAnswer } from "./plan.js";
import { type SeedTask, dayAt, eventsOf, latestTaskOf, lockNames, seedTasks, withDataRootStore } from "./store.js";
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
// options.limits changes the limits of the configuration file.
// The fake gh comes first on the PATH, so the real gh never runs and git still runs.
// Call it inside a test. After the test, it removes the folders and restores the env.
export async function useStartFixture(
  options: {
    issues?: Parameters<typeof githubIssueAnswer>[0][];
    repo?: Record<string, unknown>;
    remote?: string;
    // Limits of the configuration to change, for example { planTimeoutMin: 0.05 }.
    limits?: Record<string, number>;
  } = {},
): Promise<StartFixture> {
  const provider = await makeProviderFixture();
  onTestFinished(() => provider.remove());
  const { origin } = provider;
  const repoKey = "codeguru42/tasker";
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
  const gh = fakeGh(written.dir, {}, [
    ghTokenAnswer("codeguru42", "gho_test"),
    ...(options.issues ?? [{ project: repoKey, number: 5 }]).map(githubIssueAnswer),
  ]);
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
  const out = await runGit(["show-ref", "--verify", "--hash", "--", `refs/heads/${branch}`], {
    gitDir: fixture.clone,
    env: fixture.env,
  });
  return out.trim();
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
// It does not start a run and it makes no fake sandbox programs. Call it inside a test.
export async function usePlanFixture(
  control: FakeClaudeControl,
  options?: Parameters<typeof useStartFixture>[0],
): Promise<PlanFixture> {
  const started = await useStartedTask(options);
  const claude = useFakeClaudeOnPath(control);
  return { started, claude };
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

export interface ExecuteFixture extends PlanFixture {
  task: Task;
  revision: PlanRevision;
  config: Config;
  env: NodeJS.ProcessEnv;
}

// The setup of the tests of tasker execute: usePlanFixture(control, { repo, limits }), the fake bwrap and socat first
// on PATH, then the task moves to planning, gets revision v1 with its plan file (the answer of options.answer on top
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
  useProcessEnv({ PATH: `${useFakeSandboxBin()}${delimiter}${String(process.env.PATH)}` });
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
export function expectNoAssistantRun(fixture: PlanFixture): void {
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
// start fails. Call it inside a test.
export async function useWorkReviewTask(
  options: Parameters<typeof useStartFixture>[0] & { files?: readonly string[] } = {},
): Promise<WorkReviewTask> {
  const { files = ["work.txt"], ...fixtureOptions } = options;
  const fixture = await useStartFixture(fixtureOptions);
  const key = `${fixture.repoKey}#5`;
  await startTaskWithCommits(fixture, 5, files);
  const task = walkTask(fixture.dataRoot, fixture.repoKey, key, TO_WORK_REVIEW);
  return { ...fixture, key, task, clone: repoPaths(fixture.dataRoot, fixture.repoKey).clone, env: fixture.origin.env };
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
