import { existsSync, rmSync } from "node:fs";
import { delimiter } from "node:path";
import { onTestFinished } from "vitest";
import { start } from "../../src/commands/start.js";
import { loadConfig } from "../../src/config/load.js";
import type { Config } from "../../src/config/schema.js";
import { canonicalPath } from "../../src/real-path.js";
import { type Task } from "../../src/store/store.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { listWorktrees } from "../../src/vcs/git/worktree.js";
import { runCommand } from "./cli.js";
import { validConfig, writeDataRootConfig } from "./config.js";
import { useFakeSandboxBin } from "./fake-commands.js";
import { type FakeClaude, type FakeClaudeControl, useFakeClaude } from "./fake-claude.js";
import { type FakeGh, fakeGh, ghTokenAnswer, githubIssueAnswer } from "./fake-gh.js";
import { type GitOrigin, commitInWorktree, localBranches, makeProviderFixture, taskNames } from "./git.js";
import { withDataRootStore } from "./store.js";
import { useProcessEnv, useTempHome } from "./temp.js";

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
