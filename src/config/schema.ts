import { isAbsolute } from "node:path";
import { z } from "zod";
import { ALLOWED_ENV_NAMES } from "./allowed-env-names.js";
import { expandPath } from "./expand.js";

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
    message:
      "must not start with TASKER_: a TASKER_ variable is tasker's own and is never handed to a phase",
  })
  .refine((name) => !ALLOWED_ENV_NAMES.includes(name), {
    message:
      "must not be a name every phase already receives (such as HOME); remove it from env",
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
  site: nonEmpty.transform((site) => site.toLowerCase()).optional(),
  tracker: nonEmpty.optional(),
  account: nonEmpty.optional(),
  releaseBranchFieldId: nonEmpty.optional(),
  releaseBranchField: nonEmpty.optional(),
  updateOnStart: z.boolean().default(false),
  assignee: nonEmpty.default("@me"),
  inProgressLabel: nonEmpty.optional(),
  inProgressStatus: nonEmpty.optional(),
  updateOnFinish: z.boolean().default(false),
  doneLabel: nonEmpty.optional(),
  doneStatus: nonEmpty.optional(),
});

const RoleSchema = z.strictObject({
  model: nonEmpty,
  effort: z.enum(["low", "medium", "high"]),
});

const AssistantSchema = z.strictObject({
  provider: z.enum(["claude-code", "copilot", "pi"]),
  models: z.strictObject({ plan: RoleSchema, execute: RoleSchema, review: RoleSchema }),
  trustedExtensions: z.array(nonEmpty).default([]),
  account: nonEmpty.optional(),
  correctiveTurns: z.number().int().min(0).default(1),
});

const RepoSchema = z.strictObject({
  remote: nonEmpty,
  issueTracker: IssueTrackerSchema,
  assistant: AssistantSchema,
  verify: VerifySchema,
  bootstrap: BootstrapSchema.default({ commands: [], env: [] }),
  defaultBaseBranch: nonEmpty.optional(),
  overagePolicy: z.enum(["decline", "ask"]).default("decline"),
  quotaApprovalThreshold: z.number().gt(0).max(1).default(0.9),
  updateBranchStrategy: z.enum(["rebase", "merge"]).default("rebase"),
  forge: ForgeSchema.optional(),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectLanding(raw: unknown, ctx: z.RefinementCtx): unknown {
  if (!isObject(raw) || !Object.hasOwn(raw, "landing")) return raw;
  ctx.addIssue({
    code: "custom",
    path: ["landing"],
    message:
      "is not accepted: there is no landing setting; the command you run picks how a task lands",
  });
  const rest = { ...raw };
  delete rest.landing;
  return rest;
}

export function buildConfigSchema(env: NodeJS.ProcessEnv, homedir: string) {
  const dataRoot = z.string().transform((value, ctx) => {
    let expanded: string;
    try {
      expanded = expandPath(value, env, homedir);
    } catch (error) {
      ctx.addIssue({ code: "custom", message: (error as Error).message });
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
    dataRoot,
    retentionDays: z.number().default(30),
    dataRootMinFreeBytes: positive.default(1073741824),
    limits: LimitsSchema,
    trackers: z.record(z.string(), z.unknown()).default({}),
    repos: z.record(z.string(), RepoSchema),
  });

  return z.preprocess(rejectLanding, top);
}

export type Config = z.output<ReturnType<typeof buildConfigSchema>>;

export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  const lines: string[] = [];
  for (const issue of issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        lines.push(`${[...issue.path, key].join(".")}: unrecognized key`);
      }
      continue;
    }
    const path = issue.path.join(".") || "(config)";
    lines.push(`${path}: ${issue.message}`);
  }
  return lines;
}

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((line) => `  - ${line}`).join("\n")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

export function parseConfig(raw: unknown, env: NodeJS.ProcessEnv, homedir: string): Config {
  const result = buildConfigSchema(env, homedir).safeParse(raw);
  if (!result.success) throw new ConfigError(formatIssues(result.error.issues));
  return result.data;
}
