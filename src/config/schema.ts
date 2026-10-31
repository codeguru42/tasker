import { isAbsolute } from "node:path";
import { z } from "zod";
import { ALLOWED_ENV_NAMES } from "./allowed-env-names.js";
import { vcsConfigSchema } from "../vcs/config-schema.js";
import { LOCAL_PREFIX } from "../vcs/local-branch.js";
import { expandPath } from "./expand.js";
import { isObject } from "../object.js";
import { errorMessage } from "../error-message.js";
import { modelIssue } from "../assistant/models.js";
import type { AssistantProviderId } from "../assistant/provider.js";
import { formatIssues } from "../zod-issues.js";
import { asciiFold } from "../ascii-fold.js";

const positive = z.number().positive();

const LimitsSchema = z.strictObject({
  bootstrapTimeoutMin: positive,
  verifyTimeoutMin: positive,
  planTimeoutMin: positive.default(30),
  executeTimeoutMin: positive.default(90),
});

const nonEmpty = z.string().min(1);

const EnvNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "must be an environment variable name")
  .refine((name) => !name.startsWith("TASKER_"), {
    message: "must not start with TASKER_: a TASKER_ variable is tasker's own and is never handed to a phase",
  })
  .refine((name) => !ALLOWED_ENV_NAMES.includes(name), {
    message: "must not be a name every phase already receives (such as HOME); remove it from env",
  });

const VerifySchema = z.strictObject({
  commands: z.array(nonEmpty).min(1),
  env: z.array(EnvNameSchema).default([]),
});

const BootstrapSchema = z.strictObject({
  commands: z.array(z.string()).default([]),
  env: z.array(EnvNameSchema).default([]),
});

const ForgeSchema = z.strictObject({
  provider: z.literal("github"),
  account: nonEmpty,
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("merge"),
});

export const VCS_PROVIDER_IDS = ["git"] as const; // the vcs.provider enum
export type VcsProviderId = (typeof VCS_PROVIDER_IDS)[number];

function vcsBranch<P extends VcsProviderId>(provider: P) {
  return z.strictObject({
    provider: z.literal(provider),
    config: vcsConfigSchema(provider).default({}),
  });
}

// The preprocess only fills in the default provider on a copy. It never adds an issue and never changes raw.
const VcsSchema = z.preprocess(
  (value) => (isObject(value) && value.provider === undefined ? { ...value, provider: "git" } : value),
  z.discriminatedUnion("provider", [vcsBranch("git")]),
);

const nonEmptyList = z.array(nonEmpty).min(1);

const MatchSchema = z
  .strictObject({
    labels: nonEmptyList.optional(),
    components: nonEmptyList.optional(),
  })
  .superRefine((match, ctx) => {
    if (match.labels === undefined && match.components === undefined) {
      ctx.addIssue({ code: "custom", message: "must name labels or components" });
    }
  });

const IssueTrackerSchema = z.strictObject({
  provider: z.enum(["github", "jira"]),
  project: nonEmpty.optional(),
  match: MatchSchema.optional(),
  site: nonEmpty.transform(asciiFold).optional(),
  tracker: nonEmpty.optional(),
  account: nonEmpty.optional(),
  releaseBranchFieldId: nonEmpty.optional(),
  updateOnStart: z.boolean().default(false),
  assignee: nonEmpty.default("@me"),
  inProgressLabel: nonEmpty.optional(),
  inProgressStatus: nonEmpty.optional(),
  updateOnFinish: z.boolean().default(false),
  doneLabel: nonEmpty.optional(),
  doneStatus: nonEmpty.optional(),
});

const TrackerDefinitionSchema = IssueTrackerSchema.omit({
  project: true,
  tracker: true,
  match: true,
}).strict();

const RoleSchema = z.strictObject({
  model: nonEmpty,
  effort: z.enum(["low", "medium", "high"]),
});

const ModelsSchema = z.strictObject({ plan: RoleSchema, execute: RoleSchema, review: RoleSchema });

// The assistant roles, in the order of the report of tasker model.
export const ASSISTANT_ROLES = ModelsSchema.keyof().options;

const AssistantProviderSchema = z.enum(["claude-code", "copilot", "pi"]);

const AssistantSchema = z.strictObject({
  provider: AssistantProviderSchema,
  models: ModelsSchema,
  trustedExtensions: z.array(nonEmpty).default([]),
  account: nonEmpty.optional(),
  correctiveTurns: z.number().int().min(0).default(1),
});

// Adds an issue for each role whose model is not a model of the provider. models is raw input,
// so each read goes through a guard. at is the path of models from the object that zod refines.
function addModelIssues(
  models: unknown,
  roles: readonly string[],
  provider: AssistantProviderId,
  at: readonly string[],
  ctx: z.RefinementCtx,
): void {
  if (!isObject(models)) return;
  for (const role of roles) {
    const entry = models[role];
    if (!isObject(entry) || typeof entry.model !== "string" || entry.model === "") continue;
    const message = modelIssue(provider, entry.model);
    if (message !== undefined) {
      ctx.addIssue({ code: "custom", path: [...at, role, "model"], message });
    }
  }
}

// The model of each role must be a model of the provider. Without when, zod skips this check
// when another key of the repo fails with a wrong type, a missing key or a bad enum value, so
// the loader does not report every error in one run. With when, the check runs in all cases.
// As a result, repo can be null, a string or a partly valid object, and the check reads each
// field through a guard.
function checkModels(repo: unknown, ctx: z.RefinementCtx): void {
  if (!isObject(repo) || !isObject(repo.assistant)) return;
  const { assistant } = repo;
  const provider = AssistantProviderSchema.safeParse(assistant.provider);
  if (!provider.success) return;
  addModelIssues(assistant.models, ASSISTANT_ROLES, provider.data, ["assistant", "models"], ctx);
}

// The kind is the name that herdr gives in herdr agent start --kind.
const SessionKindSchema = z.literal("claude").default("claude");

const SessionRoleSchema = z.strictObject({
  model: nonEmpty,
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
});

const SessionModelsSchema = z.strictObject({
  operator: SessionRoleSchema.optional(),
  planner: SessionRoleSchema.optional(),
  orchestrator: SessionRoleSchema.optional(),
});

// The session roles, in the order of the report of tasker model.
export const SESSION_ROLES = SessionModelsSchema.keyof().options;
export type SessionRole = (typeof SESSION_ROLES)[number];

// The values of the effort of a session role. They hold each effort of an assistant role.
export const SESSION_EFFORTS = SessionRoleSchema.shape.effort.options;

// The provider whose model forms an agent kind uses.
const SESSION_KIND_PROVIDERS: Record<z.output<typeof SessionKindSchema>, AssistantProviderId> = {
  claude: "claude-code",
};

// Same rule as checkModels: this check runs with when, so sessions is raw input.
function checkSessionModels(sessions: unknown, ctx: z.RefinementCtx): void {
  if (!isObject(sessions)) return;
  const kind = SessionKindSchema.safeParse(sessions.kind);
  if (!kind.success) return;
  addModelIssues(sessions.models, SESSION_ROLES, SESSION_KIND_PROVIDERS[kind.data], ["models"], ctx);
}

const SessionsSchema = z
  .strictObject({
    kind: SessionKindSchema,
    models: SessionModelsSchema.default({}),
  })
  .superRefine(checkSessionModels, { when: () => true });

const RepoSchema = z
  .strictObject({
    remote: nonEmpty,
    issueTracker: IssueTrackerSchema,
    assistant: AssistantSchema,
    sessions: SessionsSchema.default({ kind: "claude", models: {} }),
    verify: VerifySchema,
    bootstrap: BootstrapSchema.default({ commands: [], env: [] }),
    defaultBaseBranch: nonEmpty
      .refine((name) => !name.startsWith(LOCAL_PREFIX), {
        message: "must name a remote branch, not a local branch in the form refs/heads/<x>",
      })
      .optional(),
    overagePolicy: z.enum(["decline", "ask"]).default("decline"),
    quotaApprovalThreshold: z.number().gt(0).max(1).default(0.9),
    updateBranchStrategy: z.enum(["rebase", "merge"]).default("rebase"),
    forge: ForgeSchema.optional(),
    vcs: VcsSchema.default({ provider: "git", config: {} }),
  })
  .superRefine(checkModels, { when: () => true });

// The github writes pass these values to a gh flag that splits on commas.
const GH_COMMA_SPLIT_KEYS = ["assignee", "inProgressLabel", "doneLabel"] as const;

// A github tracker needs the account that runs gh, and no comma in a value that gh splits.
// tasker checks the merged issueTracker, so a definition under trackers can leave account out.
function githubTrackerIssues(key: string, issueTracker: Record<string, unknown>): string[] {
  if (issueTracker.provider !== "github") {
    return [];
  }
  const issues: string[] = [];
  if (issueTracker.account === undefined) {
    issues.push(issueLine(["repos", key, "issueTracker", "account"], "is required for the github tracker"));
  }
  for (const name of GH_COMMA_SPLIT_KEYS) {
    const value = issueTracker[name];
    if (typeof value === "string" && value.includes(",")) {
      issues.push(issueLine(["repos", key, "issueTracker", name], "must not contain a comma for the github tracker"));
    }
  }
  return issues;
}

// acli has no flag for a site or a user for one call, so a Jira repo sets no account. A Jira repo uses statuses, not labels.
const JIRA_REFUSED_KEYS = ["account", "inProgressLabel", "doneLabel"] as const;

// A jira tracker refuses the keys that mean nothing for it.
function jiraTrackerIssues(key: string, issueTracker: Record<string, unknown>): string[] {
  if (issueTracker.provider !== "jira") {
    return [];
  }
  const issues: string[] = [];
  for (const name of JIRA_REFUSED_KEYS) {
    if (issueTracker[name] !== undefined) {
      issues.push(issueLine(["repos", key, "issueTracker", name], "is not accepted for the jira tracker"));
    }
  }
  return issues;
}

function trackerIssues(key: string, issueTracker: Record<string, unknown>): string[] {
  return [...githubTrackerIssues(key, issueTracker), ...jiraTrackerIssues(key, issueTracker)];
}

interface Prepared {
  input: unknown;
  issues: string[];
}

function issueLine(path: readonly (string | number)[], message: string): string {
  return `${path.join(".")}: ${message}`;
}

// Runs before the schema. It finds the errors that the schema cannot see, and it
// returns a cleaned copy of the input. It never changes raw or an object inside it.
function prepareConfig(raw: unknown): Prepared {
  if (!isObject(raw)) return { input: raw, issues: [] };
  const issues: string[] = [];
  const copy: Record<string, unknown> = { ...raw };
  if (Object.hasOwn(copy, "landing")) {
    issues.push(
      issueLine(
        ["landing"],
        "is not accepted: there is no landing setting; the command you run picks how a task lands",
      ),
    );
    delete copy.landing;
  }
  let trackersBroken = false;
  if (copy.trackers !== undefined && !isObject(copy.trackers)) {
    issues.push(issueLine(["trackers"], "must be an object that maps each tracker name to its definition"));
    delete copy.trackers;
    trackersBroken = true;
  }
  if (!isObject(copy.repos)) return { input: copy, issues };
  const trackers = isObject(copy.trackers) ? copy.trackers : {};
  const repos: Record<string, unknown> = {};
  for (const [key, repo] of Object.entries(copy.repos)) {
    const issueTracker = isObject(repo) ? repo.issueTracker : undefined;
    if (!isObject(repo) || !isObject(issueTracker) || typeof issueTracker.tracker !== "string") {
      if (isObject(repo) && isObject(issueTracker)) {
        issues.push(...trackerIssues(key, issueTracker));
      }
      repos[key] = repo;
      continue;
    }
    const name = issueTracker.tracker;
    const at = ["repos", key, "issueTracker"];
    if (Object.hasOwn(issueTracker, "provider")) {
      issues.push(
        issueLine([...at, "provider"], `must not be set next to tracker; provider comes from tracker '${name}'`),
      );
    }
    const own: Record<string, unknown> = { ...issueTracker };
    delete own.provider;
    // A repo that names a missing or bad tracker gets a placeholder provider.
    // The real error is already reported once: under the tracker name for a
    // missing definition, or under trackers.<name> for a bad one. Without the
    // placeholder, the issueTracker schema adds a second error for the provider.
    // The repo's own provider is removed first, because its error is already
    // reported above.
    const placeholder = { provider: "github", ...own };
    if (trackersBroken) {
      repos[key] = { ...repo, issueTracker: placeholder };
      continue;
    }
    const definition = Object.hasOwn(trackers, name) ? trackers[name] : undefined;
    if (definition === undefined) {
      issues.push(issueLine([...at, "tracker"], `names tracker '${name}', which is not defined under trackers`));
    }
    // Merge the raw definition, so the issueTracker schema applies the defaults once.
    const validDefinition = definition !== undefined && TrackerDefinitionSchema.safeParse(definition).success;
    const merged = validDefinition ? { ...(definition as Record<string, unknown>), ...own } : placeholder;
    if (validDefinition) {
      // Never on the placeholder: the real error is already reported.
      issues.push(...trackerIssues(key, merged));
    }
    repos[key] = { ...repo, issueTracker: merged };
  }
  return { input: { ...copy, repos }, issues };
}

export function buildConfigSchema(env: NodeJS.ProcessEnv, homedir: string) {
  const absolutePath = z.string().transform((value, ctx) => {
    let expanded: string;
    try {
      expanded = expandPath(value, env, homedir);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: errorMessage(error) });
      return z.NEVER;
    }
    if (!isAbsolute(expanded)) {
      ctx.addIssue({
        code: "custom",
        message: `must resolve to an absolute path, got: ${expanded}`,
      });
      return z.NEVER;
    }
    return expanded;
  });

  const top = z.strictObject({
    dataRoot: absolutePath,
    retentionDays: z.number().default(30),
    dataRootMinFreeBytes: positive.default(1073741824),
    skillsDirs: z.array(absolutePath).min(1).prefault(["~/.claude/skills"]),
    limits: LimitsSchema,
    trackers: z.record(z.string(), TrackerDefinitionSchema).default({}),
    repos: z.record(z.string(), RepoSchema),
  });

  return top;
}

export type Config = z.output<ReturnType<typeof buildConfigSchema>>;
export type RepoConfig = Config["repos"][string];

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((line) => `  - ${line}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv, homedir: string): Config {
  const { input, issues } = prepareConfig(raw);
  const result = buildConfigSchema(env, homedir).safeParse(input);
  if (!result.success) throw new ConfigError([...issues, ...formatIssues(result.error.issues, "(config)")]);
  if (issues.length > 0) throw new ConfigError(issues);
  return result.data;
}
