import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type AssistantEvent,
  type AssistantRole,
  createAssistantProvider,
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
}

export interface PlanModeRunRequest extends TaskRunRequest {
  role: "plan" | "review";
}

interface StartInput {
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  onEvent?: (event: AssistantEvent) => void;
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

// The one home of the steps that both entry points share. Neither entry point repeats one of them.
function prepareCommonRun(req: TaskRunRequest, role: AssistantRole): CommonRun {
  const { config, store, task, env } = req;
  const worktree = task.worktreePath;
  if (worktree === null) throw new Error(`task ${task.id} has no worktree`);
  const selected = createAssistantProvider(task.repoKey, config.repos[task.repoKey]!, role);
  const sessionId = randomUUID();
  const { vcs, ctx } = vcsForRepo(config, task.repoKey, env);
  return {
    worktree,
    surface: vcs.assistantSurface(ctx),
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
        resume: false,
        model: selected.model,
        effort: selected.effort,
        sessionDir,
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

// The one home of the read deny list of the shell of the execute role. No other code builds a part of it.
// Each entry goes in only when the variables that it needs are set. Every value comes from env, never from
// the home folder of the host. A path that does not exist still goes in the list.
export function executeReadDenyPaths(o: {
  env: NodeJS.ProcessEnv;
  surfaceDenyReadPaths: readonly string[];
  publishTokensPath: string;
}): string[] {
  const { env } = o;
  const home = isSet(env.HOME) ? env.HOME : undefined;
  const paths = [...o.surfaceDenyReadPaths];
  if (home) paths.push(join(home, ".ssh"));
  if (isSet(env.GH_CONFIG_DIR)) paths.push(env.GH_CONFIG_DIR);
  else if (isSet(env.XDG_CONFIG_HOME)) paths.push(join(env.XDG_CONFIG_HOME, "gh"));
  else if (home) paths.push(join(home, ".config", "gh"));
  if (home) paths.push(join(home, ".git-credentials"), join(home, ".netrc"));
  if (isSet(env.CLAUDE_CONFIG_DIR)) paths.push(join(env.CLAUDE_CONFIG_DIR, ".credentials.json"));
  else if (home) paths.push(join(home, ".claude", ".credentials.json"));
  paths.push(o.publishTokensPath);
  // resolveConfigPath() reads its homedir argument only when TASKER_CONFIG and XDG_CONFIG_HOME are
  // unset, and the default of that argument is the home folder of the host. So the entry goes in
  // only when the env names the file or a folder for it, and the call never passes undefined.
  if (isSet(env.TASKER_CONFIG) || isSet(env.XDG_CONFIG_HOME) || isSet(env.HOME)) {
    paths.push(resolveConfigPath(env, env.HOME ?? ""));
  }
  return paths;
}
