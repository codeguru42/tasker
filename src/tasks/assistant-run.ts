import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type AssistantEvent,
  type AssistantRole,
  createAssistantProvider,
  createSessionProvider,
  type PermissionMode,
  type RecordedSession,
  type RunOutcome,
  type SandboxLimits,
} from "../assistant/provider.js";
import { isSet, resolveConfigPath } from "../config/path.js";
import type { Config } from "../config/schema.js";
import { taskSessionsDir } from "../store/layout.js";
import type { Task, TaskStore } from "../store/store.js";
import { type AssistantSurface, vcsForRepo } from "../vcs/provider.js";

export type AssistantSessionRequest =
  | { resume: false }
  | { resume: true; sessionId: string; recorded: RecordedSession };

// The input that both entry points take.
export interface TaskRunRequest {
  config: Config;
  // Holds the run marker of the task.
  store: TaskStore;
  // The worktreePath of the task must be set.
  task: Task;
  session: AssistantSessionRequest;
  // The env of tasker, passed on unchanged.
  env: NodeJS.ProcessEnv;
  // The end of the approved quota window, in Unix seconds. The run uses it only under overagePolicy "decline".
  approvedResetsAt?: number;
}

export interface PlanModeRunRequest extends TaskRunRequest {
  role: "plan" | "review";
}

interface StartInput {
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  onEvent?: (event: AssistantEvent) => void;
}

export interface PreparedExecuteRun {
  sessionId: string;
  session: RecordedSession;
  // The commit text for the prompt of the run. It holds the {{BASE_REF}} placeholder.
  executeCommitText: string;
  start(input: StartInput): Promise<RunOutcome>;
}

export interface PreparedPlanModeRun {
  sessionId: string;
  session: RecordedSession;
  start(input: StartInput): Promise<RunOutcome>;
}

// The limits that each entry point gives for its role.
interface RoleLimits {
  permissionMode: PermissionMode;
  timeoutMs: number;
  allowedTools?: readonly string[];
  disallowedTools: readonly string[];
  sandbox?: SandboxLimits;
}

interface CommonRun {
  worktree: string;
  surface: AssistantSurface;
  sessionId: string;
  session: RecordedSession;
  run(limits: RoleLimits, input: StartInput): Promise<RunOutcome>;
}

// The assistant surface of one configured repo.
function assistantSurfaceOf(config: Config, repoKey: string, env: NodeJS.ProcessEnv): AssistantSurface {
  const { vcs, ctx } = vcsForRepo(config, repoKey, env);
  return vcs.assistantSurface(ctx);
}

// The one home of the steps that both entry points share. Neither entry point repeats one of them.
function prepareCommonRun(req: TaskRunRequest, role: AssistantRole): CommonRun {
  const { config, store, task, env, session: request } = req;
  const worktree = task.worktreePath;
  if (worktree === null) throw new Error(`task ${task.id} has no worktree`);
  // A continued session keeps the provider, model and effort that it recorded, also after the configuration changed.
  const resume = request.resume;
  const selected = request.resume
    ? createSessionProvider(request.recorded)
    : createAssistantProvider(task.repoKey, config.repos[task.repoKey]!, role);
  const sessionId = request.resume ? request.sessionId : randomUUID();
  return {
    worktree,
    surface: assistantSurfaceOf(config, task.repoKey, env),
    sessionId,
    session: {
      repoKey: task.repoKey,
      provider: selected.provider.id,
      model: selected.model,
      effort: selected.effort,
    },
    run(limits, input) {
      const sessionDir = taskSessionsDir(config.dataRoot, task);
      mkdirSync(sessionDir, { recursive: true });
      return selected.provider.run({
        ...limits,
        cwd: worktree,
        // The child-env filter of the provider is the one home of the env rule. Nothing is removed here.
        env,
        prompt: input.prompt,
        jsonSchema: input.jsonSchema,
        sessionId,
        resume,
        model: selected.model,
        effort: selected.effort,
        sessionDir,
        // Under "ask", the caller handles paid usage, so the run has no overage stop.
        overageStop:
          config.repos[task.repoKey]!.overagePolicy === "decline"
            ? { approvedResetsAt: req.approvedResetsAt }
            : undefined,
        onSpawn: (pid) => store.setRunChildPid(task.id, pid),
        onEvent: input.onEvent,
      });
    },
  };
}

// Prepares the run of the assistant of a task in the plan or the review role. The two roles differ
// only in their model row, so they share one entry point. For now, tasker relies on the plan mode
// for these roles, with no sandbox and no tool rule except the deny rules of the version control.
// The caller must move the task into a spawning state before start().
// The caller must record sessionId and session before start().
export async function prepareTaskPlanModeRun(req: PlanModeRunRequest): Promise<PreparedPlanModeRun> {
  const common = prepareCommonRun(req, req.role);
  const limits: RoleLimits = {
    permissionMode: "plan",
    timeoutMs: req.config.limits.planTimeoutMin * 60_000,
    disallowedTools: [...common.surface.denyRules],
  };
  return {
    sessionId: common.sessionId,
    session: common.session,
    start: (input) => common.run(limits, input),
  };
}

// Prepares the run of the assistant of a task in the execute role. This role does steps that the plan
// and review roles do not do: the path rules, the sandbox and the commit text.
// The caller must move the task into a spawning state before start().
// The caller must record sessionId and session before start().
// The caller must replace {{BASE_REF}} in executeCommitText before it puts the text in the prompt.
export async function prepareTaskExecuteRun(req: TaskRunRequest): Promise<PreparedExecuteRun> {
  const common = prepareCommonRun(req, "execute");
  const { surface, worktree: wt } = common;
  const clone = await surface.sharedFolder(wt);
  // The path is absolute. The // prefix marks an absolute path in the rule syntax of claude.
  const rule = (tool: string, absolutePath: string) => `${tool}(/${absolutePath})`;
  const limits: RoleLimits = {
    // Under dontAsk, a tool call that no allow rule covers is denied.
    permissionMode: "dontAsk",
    timeoutMs: req.config.limits.executeTimeoutMin * 60_000,
    // The path rules keep Read, Glob and Grep in the worktree.
    allowedTools: [
      rule("Read", `${wt}/**`),
      rule("Glob", `${wt}/**`),
      rule("Grep", `${wt}/**`),
      rule("Edit", `${wt}/**`),
      rule("Write", `${wt}/**`),
      "Bash",
    ],
    // A deny wins over an allow, so git data changes only through git in the sandboxed shell.
    disallowedTools: [
      ...surface.denyRules,
      ...["Edit", "Write"].flatMap((tool) => [
        rule(tool, `${wt}/.git`),
        rule(tool, `${wt}/.git/**`),
        rule(tool, `${clone}/**`),
      ]),
    ],
    sandbox: {
      allowWrite: await surface.sandboxWritePaths(wt),
      denyRead: executeReadDenyPaths({
        env: req.env,
        // The shared steps already built the surface of the task repo, so only the other repos get a new one.
        repos: Object.keys(req.config.repos).map((key) =>
          key === req.task.repoKey ? surface : assistantSurfaceOf(req.config, key, req.env),
        ),
      }),
      trackedPaths: (paths) => surface.trackedPaths(wt, paths),
      sharedFolder: clone,
    },
  };
  return {
    sessionId: common.sessionId,
    session: common.session,
    executeCommitText: surface.executeCommitText,
    start: (input) => common.run(limits, input),
  };
}

// The paths that one configured repo gives for the read deny list. AssistantSurface has both fields.
export interface RepoReadDenyPaths {
  denyReadPaths: readonly string[];
  publishTokensPath: string;
}

// The one home of the read deny list of the shell of the execute role. No other code builds a part of it.
// The list covers every configured repo, because with the key of any repo the shell can push to that repo.
// Each entry goes in only when the variables that it needs are set. Every value comes from env, never from
// the home folder of the host. A path that does not exist still goes in the list.
export function executeReadDenyPaths(o: {
  env: NodeJS.ProcessEnv;
  repos: readonly RepoReadDenyPaths[];
}): string[] {
  const { env, repos } = o;
  const home = isSet(env.HOME) ? env.HOME : undefined;
  const fromEnv: string[] = [];
  if (home) fromEnv.push(join(home, ".ssh"));
  if (isSet(env.GH_CONFIG_DIR)) fromEnv.push(env.GH_CONFIG_DIR);
  else if (isSet(env.XDG_CONFIG_HOME)) fromEnv.push(join(env.XDG_CONFIG_HOME, "gh"));
  else if (home) fromEnv.push(join(home, ".config", "gh"));
  if (home) fromEnv.push(join(home, ".git-credentials"), join(home, ".netrc"));
  if (isSet(env.CLAUDE_CONFIG_DIR)) fromEnv.push(join(env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  else if (home) fromEnv.push(join(home, ".claude", ".credentials.json"));
  // resolveConfigPath() reads its homedir argument only when TASKER_CONFIG and XDG_CONFIG_HOME are
  // unset, and the default of that argument is the home folder of the host. So the entry goes in
  // only when the env names the file or a folder for it, and the call never passes undefined.
  const configFile =
    isSet(env.TASKER_CONFIG) || isSet(env.XDG_CONFIG_HOME) || home !== undefined
      ? [resolveConfigPath(env, home ?? "")]
      : [];
  // The shell runs in the worktree, so a relative path from the env would name a different file there.
  const absolute = (paths: readonly string[]) => paths.map((path) => resolve(path));
  return [
    ...repos.flatMap((repo) => repo.denyReadPaths),
    ...absolute(fromEnv),
    ...repos.map((repo) => repo.publishTokensPath),
    ...absolute(configFile),
  ];
}
