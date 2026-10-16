import { type Config, ConfigError, type RepoConfig } from "../config/schema.js";
import { reposByProvider } from "../config/repo-groups.js";
import type { Check } from "../doctor/check.js";
import { createClaudeCodeProvider } from "./claude-code/provider.js";

// The id of an assistant: the value of assistant.provider.
export type AssistantProviderId = RepoConfig["assistant"]["provider"];
export type AssistantRole = keyof RepoConfig["assistant"]["models"];
export type Effort = RepoConfig["assistant"]["models"]["plan"]["effort"];
export type PermissionMode = "plan" | "dontAsk" | "auto";

export interface SandboxLimits {
  allowWrite: string[];
  denyRead: string[];
  // The subset of paths (relative to cwd) that the version control tracks, from one call.
  // The caller builds it from vcs.assistantSurface(ctx).trackedPaths.
  trackedPaths: (paths: readonly string[]) => Promise<string[]>;
  // The absolute path of the folder that the workspaces of the clone share.
  // The caller fills it from vcs.assistantSurface(ctx).sharedFolder(cwd).
  sharedFolder: string;
}

// What the provider removed after a sandboxed run: relative paths, sorted, or the error.
export type SandboxCleanup = { removed: string[] } | { error: string };

export interface OverageStop {
  approvedResetsAt?: number;
}

// One parsed event of the stream of the assistant.
export type AssistantEvent = Record<string, unknown>;

export interface PermissionDenial {
  tool: string;
  input: unknown;
}

export interface RunInput {
  // Tasker makes the session id before the run. A provider never makes one.
  sessionId: string;
  // The only difference between a new and a continued run.
  resume: boolean;
  // Goes to stdin, never to argv.
  prompt: string;
  cwd: string;
  // The provider removes from env what its child must not see.
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  // Belongs to tasker.
  sessionDir: string;
  jsonSchema?: Record<string, unknown>;
  permissionMode?: PermissionMode;
  allowedTools?: readonly string[];
  // A deny wins over an allow.
  disallowedTools?: readonly string[];
  // No fallback to a shell with no sandbox. The network stays open.
  sandbox?: SandboxLimits;
  model: string;
  effort: Effort;
  // Set only under overagePolicy: "decline".
  overageStop?: OverageStop;
  onEvent?: (event: AssistantEvent) => void;
  onSpawn?: (pid: number) => void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

// "unavailable" when the provider has no usage data. Never zeros in that case.
export type Usage = TokenUsage | "unavailable";

interface OutcomeBase {
  sessionId: string;
  events: AssistantEvent[];
  permissionDenials: PermissionDenial[];
  usage: Usage;
  transcriptPath?: string;
  reportedModel?: string;
  // Only a sandboxed run that got to the spawn step sets it.
  sandboxCleanup?: SandboxCleanup;
}

export type RunOutcome =
  | (OutcomeBase & { kind: "success"; structuredOutput?: unknown })
  | (OutcomeBase & { kind: "failure"; exitCode: number | null; signal: NodeJS.Signals | null; reason: string })
  | (OutcomeBase & { kind: "timeout" })
  | (OutcomeBase & { kind: "quota"; resetsAt?: number; cause: "rate_limit" | "overage" });

// A run that passed quotaApprovalThreshold. resetsAt is the end of the quota window, in Unix seconds.
export interface QuotaApprovalWarning {
  utilization: number;
  resetsAt?: number;
}

// A repo that the doctor checks of a provider check: its repo key and its assistant.
export interface AssistantDoctorRepo {
  key: string;
  assistant: RepoConfig["assistant"];
}

export interface ModelChoice {
  model: string;
  effort: Effort;
}

// The provider of a session, with the model and the effort of that session.
export interface SelectedAssistant extends ModelChoice {
  provider: AssistantProvider;
}

// What a session recorded when it started.
export interface RecordedSession extends ModelChoice {
  repoKey: string;
  provider: AssistantProviderId;
}

/**
 * An assistant: the coding-agent program that tasker starts in the worktree of a task, to plan,
 * to execute and to review. A command gets a provider from createAssistantProvider() or
 * createSessionProvider() and never imports a provider module.
 *
 * Refuse, never drop: a provider that cannot enforce a limit that tasker asks for (a tool rule,
 * a sandbox, a permission mode) gives a "failure" outcome before the spawn. It never runs with
 * less confinement than tasker asked for.
 */
export interface AssistantProvider {
  readonly id: AssistantProviderId;
  // Starts or continues one session. It never throws for a failed run.
  run(input: RunInput): Promise<RunOutcome>;
  // tasker doctor calls it once with all the repos of the provider. [] is permitted.
  doctorChecks(repos: readonly AssistantDoctorRepo[]): Check[];
  // Checks for a continued session that runs on a recorded model, not on the configured model.
  modelChecks(model: string): Check[];
  // Whether the run passed quotaApprovalThreshold. Only the provider can read its own stream.
  detectQuotaApprovalWarning(outcome: RunOutcome, threshold: number): QuotaApprovalWarning | undefined;
  // Whether the warning is for a quota window that the operator already approved.
  shouldSuppressQuotaApprovalPause(warning: QuotaApprovalWarning, approvedResetsAt: number | undefined): boolean;
}

// The one switch on the provider id. The copilot and pi providers are not available yet.
function providerFor(repoKey: string, id: AssistantProviderId): AssistantProvider {
  switch (id) {
    case "claude-code":
      return createClaudeCodeProvider();
    case "copilot":
    case "pi":
      throw new ConfigError([
        `repos.${repoKey}.assistant.provider: the ${id} assistant is not available in this version`,
      ]);
  }
}

// The only place that picks the provider of a new session. It reads assistant.provider and the
// model and the effort of assistant.models.<role>.
export function createAssistantProvider(
  repoKey: string,
  repo: Pick<RepoConfig, "assistant">,
  role: AssistantRole,
): SelectedAssistant {
  const { model, effort } = repo.assistant.models[role];
  return { provider: providerFor(repoKey, repo.assistant.provider), model, effort };
}

// Picks the provider of a continued session from what the session recorded when it started.
// A continued session must keep its provider, model and effort, also after the configuration changed.
export function createSessionProvider(recorded: RecordedSession): SelectedAssistant {
  const { repoKey, provider, model, effort } = recorded;
  return { provider: providerFor(repoKey, provider), model, effort };
}

// The doctor checks of the assistant providers that the configuration uses. It groups the repos by
// provider id with reposByProvider(), and calls doctorChecks() once for each id with all the repos
// of that id. A repo with a provider that is not available gives the ConfigError of the pick.
// A configuration with no repo gives [].
export function assistantDoctorChecks(config: Config): Check[] {
  return reposByProvider(
    config,
    (repo) => repo.assistant.provider,
    (key, repo): AssistantDoctorRepo => ({ key, assistant: repo.assistant }),
  ).flatMap(([id, repos]) => providerFor(repos[0].key, id).doctorChecks(repos));
}
