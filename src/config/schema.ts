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
import { JIRA_PROJECT, SITE_LABEL } from "../issue-key/short-ref.js";

const positive = z.number().positive();

const LimitsSchema = z.strictObject({
  bootstrapTimeoutMin: positive.describe("Minutes that the bootstrap phase can run."),
  verifyTimeoutMin: positive.describe("Minutes that the verify phase can run."),
  planTimeoutMin: positive.default(30).describe("Minutes that the plan phase or a review run can run."),
  executeTimeoutMin: positive.default(90).describe("Minutes that the execute phase can run."),
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
  commands: z
    .array(nonEmpty)
    .min(1)
    .describe("Commands that tasker runs for verification, in order. The list cannot be empty."),
  env: z
    .array(EnvNameSchema)
    .default([])
    .describe(
      "Environment variable names that tasker passes to verify commands. Names must match `^[A-Za-z_][A-Za-z0-9_]*$`, must not start with `TASKER_`, and must not name variables every phase already receives, such as `HOME`.",
    ),
});

const BootstrapSchema = z.strictObject({
  commands: z.array(z.string()).default([]).describe("Commands that tasker runs during bootstrap, in order."),
  env: z
    .array(EnvNameSchema)
    .default([])
    .describe(
      "Environment variable names that tasker passes to bootstrap commands. Names must match `^[A-Za-z_][A-Za-z0-9_]*$`, must not start with `TASKER_`, and must not name variables every phase already receives, such as `HOME`.",
    ),
});

const ForgeSchema = z.strictObject({
  provider: z.literal("github").describe("The kind of forge."),
  account: nonEmpty.describe("The account to use."),
  mergeMethod: z.enum(["merge", "squash", "rebase"]).default("merge").describe("How to merge a pull request."),
});

export const VCS_PROVIDER_IDS = ["git"] as const; // the vcs.provider enum
export type VcsProviderId = (typeof VCS_PROVIDER_IDS)[number];

function vcsBranch<P extends VcsProviderId>(provider: P) {
  return z.strictObject({
    provider: z.literal(provider).describe('The kind of version control. "git" is the only permitted value.').meta({
      effectiveDefault: "git",
      required: false,
    }),
    config: vcsConfigSchema(provider)
      .default({})
      .describe("The configuration of the provider.")
      .meta({ effectiveDefault: {} }),
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
    labels: nonEmptyList.optional().describe("Labels that an issue must have to match."),
    components: nonEmptyList.optional().describe("Components that an issue must have to match."),
  })
  .superRefine((match, ctx) => {
    if (match.labels === undefined && match.components === undefined) {
      ctx.addIssue({ code: "custom", message: "must name labels or components" });
    }
  });

const IssueTrackerSchema = z.strictObject({
  provider: z
    .enum(["github", "jira"])
    .describe(
      "The kind of tracker. A provider is required without `tracker`, and it must be absent when `tracker` is set.",
    )
    .meta({ required: false }),
  project: nonEmpty
    .optional()
    .describe(
      "The project of the tracker. If it is absent, tasker uses the repo key. For Jira, a set project must be a Jira project key such as PROJ. If the repo key is not a Jira project key, Jira requires a project.",
    ),
  match: MatchSchema.optional().describe(
    "Issue fields that tasker uses to match an issue to this repo. Set `labels` or `components`.",
  ),
  site: nonEmpty
    .transform(asciiFold)
    .optional()
    .describe(
      "The site of the tracker. ASCII uppercase letters fold to lowercase. Jira requires a bare host name with a dot, such as example.atlassian.net.",
    ),
  tracker: nonEmpty.optional().describe("The name of an entry under trackers."),
  account: nonEmpty
    .optional()
    .describe("The account that tasker uses for the tracker. GitHub requires it, and Jira refuses it.")
    .meta({ provider: "github" }),
  baseBranchFieldName: nonEmpty
    .optional()
    .describe("For Jira, the custom field that holds an issue's base branch.")
    .meta({ provider: "jira" }),
  apiToken: nonEmpty
    .optional()
    .describe("For Jira, the API token used to look up the base branch field id.")
    .meta({ provider: "jira" }),
  email: nonEmpty
    .optional()
    .describe("For Jira, the email address of the API token account.")
    .meta({ provider: "jira" }),
  updateOnStart: z
    .boolean()
    .default(false)
    .describe("Whether tasker assigns the issue and marks it in progress at start."),
  assignee: nonEmpty.default("@me").describe("The account that tasker assigns the issue to. GitHub refuses commas."),
  inProgressLabel: nonEmpty
    .optional()
    .describe(
      "For GitHub, the label that tasker adds and checks for at start. GitHub refuses commas, and Jira refuses this field.",
    )
    .meta({ provider: "github" }),
  inProgressStatus: nonEmpty
    .optional()
    .describe("For Jira, the status that tasker moves the issue to at start.")
    .meta({ provider: "jira" }),
  updateOnFinish: z
    .boolean()
    .default(false)
    .describe("Whether tasker marks the issue done after it removes the worktree and branch."),
  doneLabel: nonEmpty
    .optional()
    .describe(
      "For GitHub, the label that tasker adds when it finishes the issue. GitHub refuses commas, and Jira refuses this field.",
    )
    .meta({ provider: "github" }),
  doneStatus: nonEmpty
    .optional()
    .describe(
      "For Jira, the status that tasker moves the issue to when it finishes. Jira requires it when `updateOnFinish` is true.",
    )
    .meta({ provider: "jira" }),
  abortStatus: nonEmpty
    .optional()
    .describe("For Jira, the status that tasker moves the issue to when it aborts. GitHub refuses this field.")
    .meta({ provider: "jira" }),
});

const TrackerDefinitionSchema = IssueTrackerSchema.omit({ project: true, tracker: true, match: true })
  .extend({
    provider: z.enum(["github", "jira"]).describe("The kind of tracker.").meta({ required: true }),
  })
  .strict()
  .describe("A named issue tracker definition that repos share.");

const RoleSchema = z.strictObject({
  model: nonEmpty.describe("The model to use for this assistant role. It must belong to the assistant provider."),
  effort: z.enum(["low", "medium", "high"]).describe("The effort level to use for this assistant role."),
});

const ModelsSchema = z.strictObject({
  plan: RoleSchema.describe("The model and effort for plan sessions."),
  execute: RoleSchema.describe("The model and effort for execute sessions."),
  review: RoleSchema.describe("The model and effort for review sessions."),
});

// The assistant roles, in the order of the report of tasker model.
export const ASSISTANT_ROLES = ModelsSchema.keyof().options;

const AssistantProviderSchema = z.enum(["claude-code", "copilot", "pi", "codex"]);

function checkTrustedExtensions(assistant: unknown, ctx: z.RefinementCtx): void {
  if (!isObject(assistant) || !Object.hasOwn(assistant, "trustedExtensions")) return;
  const provider = AssistantProviderSchema.safeParse(assistant.provider);
  if (!provider.success || provider.data === "pi") return;
  ctx.addIssue({
    code: "custom",
    path: ["trustedExtensions"],
    message: "only the pi provider accepts this key",
  });
}

const AssistantSchema = z
  .strictObject({
    provider: AssistantProviderSchema.describe("The assistant to run."),
    models: ModelsSchema.describe("The models and effort levels for the assistant roles."),
    trustedExtensions: z
      .array(nonEmpty)
      .optional()
      .describe("Extensions that a pi session can trust. Only pi accepts this field.")
      .meta({ provider: "pi", default: [] }),
    account: nonEmpty.optional().describe("The account to use."),
    correctiveTurns: z
      .number()
      .int()
      .min(0)
      .default(1)
      .describe("The maximum corrective turns that pi starts for a refused answer.")
      .meta({ provider: "pi" }),
  })
  .superRefine(checkTrustedExtensions, { when: () => true })
  .transform((assistant) => ({ ...assistant, trustedExtensions: assistant.trustedExtensions ?? [] }));

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
  model: nonEmpty.describe("The model to use for this session role. It must be a model of the agent kind's provider."),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).describe("The effort level to use for this session role."),
});

const SessionModelsSchema = z.strictObject({
  operator: SessionRoleSchema.optional().describe("The model and effort for operator sessions."),
  planner: SessionRoleSchema.optional().describe("The model and effort for planner sessions."),
  orchestrator: SessionRoleSchema.optional().describe("The model and effort for orchestrator sessions."),
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
    kind: SessionKindSchema.describe("The agent kind used for each session role."),
    models: SessionModelsSchema.default({}).describe("The optional models and effort levels for session roles."),
  })
  .superRefine(checkSessionModels, { when: () => true });

const RepoSchema = z
  .strictObject({
    remote: nonEmpty.describe("The remote address of the repo."),
    issueTracker: IssueTrackerSchema.describe("The issue tracker for this repo."),
    assistant: AssistantSchema.describe("The assistant and role models for this repo."),
    sessions: SessionsSchema.default({ kind: "claude", models: {} }).describe(
      "The agent kind and models of operator, planner, and orchestrator sessions.",
    ),
    verify: VerifySchema.describe("The commands and environment for the verify phase."),
    bootstrap: BootstrapSchema.default({ commands: [], env: [] }).describe(
      "The commands and environment for the bootstrap phase.",
    ),
    defaultBaseBranch: nonEmpty
      .refine((name) => !name.startsWith(LOCAL_PREFIX), {
        message: "must name a remote branch, not a local branch in the form refs/heads/<x>",
      })
      .optional()
      .describe(
        "The origin branch that tasks start from when no learned default exists. It must not start with `refs/heads/`.",
      ),
    overagePolicy: z.enum(["decline", "ask"]).default("decline").describe("What tasker does when quota use gets high."),
    quotaApprovalThreshold: z
      .number()
      .gt(0)
      .max(1)
      .default(0.9)
      .describe("The share of the quota window that pauses a run under ask policy."),
    updateBranchStrategy: z
      .enum(["rebase", "merge"])
      .default("rebase")
      .describe("How tasker brings a branch up to date."),
    forge: ForgeSchema.optional().describe("The forge used for pull requests."),
    vcs: VcsSchema.default({ provider: "git", config: {} })
      .describe("The version control provider and its configuration.")
      .meta({ effectiveDefault: { provider: "git", config: {} } }),
  })
  .superRefine(checkModels, { when: () => true })
  .describe("Configuration for one repo.");

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
  if (issueTracker.abortStatus !== undefined) {
    issues.push(issueLine(["repos", key, "issueTracker", "abortStatus"], "is not accepted for the github tracker"));
  }
  return issues;
}

// acli has no flag for a site or a user for one call, so a Jira repo sets no account. A Jira repo uses statuses, not labels.
const JIRA_REFUSED_KEYS = ["account", "inProgressLabel", "doneLabel"] as const;

const JIRA_PROJECT_PATTERN = new RegExp(`^${JIRA_PROJECT}$`);
const JIRA_SITE_PATTERN = new RegExp(`^${SITE_LABEL}(?:\\.${SITE_LABEL})+$`);

// The rules of a jira tracker on the merged issueTracker. A value that is not a string gets no line here, because the schema reports its type.
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
  const { project } = issueTracker;
  if (project === undefined && !JIRA_PROJECT_PATTERN.test(key)) {
    issues.push(
      issueLine(
        ["repos", key, "issueTracker", "project"],
        `is required for the jira tracker when the repo key ${key} is not a Jira project key`,
      ),
    );
  }
  if (typeof project === "string" && !JIRA_PROJECT_PATTERN.test(project)) {
    issues.push(
      issueLine(
        ["repos", key, "issueTracker", "project"],
        `must be a Jira project key that matches ^${JIRA_PROJECT}$, got ${project}`,
      ),
    );
  }
  const { site } = issueTracker;
  if (typeof site === "string" && !JIRA_SITE_PATTERN.test(site)) {
    issues.push(
      issueLine(
        ["repos", key, "issueTracker", "site"],
        "must be a host name such as example.atlassian.net, with no scheme, path or port",
      ),
    );
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
    dataRoot: absolutePath.describe(
      "The folder where tasker keeps its data. Tasker expands a leading `~`, `$NAME`, or `${NAME}` and requires an absolute path. It rejects an unset or empty variable.",
    ),
    retentionDays: z.number().default(30).describe("How many days tasker keeps data."),
    dataRootMinFreeBytes: positive.default(1073741824).describe("The free space that dataRoot must have, in bytes."),
    skillsDirs: z
      .array(absolutePath)
      .min(1)
      .prefault(["~/.claude/skills"])
      .describe(
        "Folders where tasker install-skills copies the skills. Tasker expands a leading `~`, `$NAME`, or `${NAME}` and requires an absolute path. It rejects an unset or empty variable.",
      ),
    limits: LimitsSchema.describe("The time limits for task phases."),
    trackers: z
      .record(z.string(), TrackerDefinitionSchema)
      .default({})
      .describe("Named issue tracker definitions that repos share.")
      .meta({ effectiveDefault: {} }),
    repos: z.record(z.string(), RepoSchema).describe("Maps each repo key to its configuration."),
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
