import { isAbsolute } from "node:path";
import { z } from "zod";
import { expandPath } from "./expand.js";

const positive = z.number().positive();

const LimitsSchema = z.strictObject({
  bootstrapTimeoutMin: positive,
  verifyTimeoutMin: positive,
  planTimeoutMin: positive.default(30),
  executeTimeoutMin: positive.default(90),
});

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

  return z.strictObject({
    dataRoot,
    retentionDays: z.number().default(30),
    dataRootMinFreeBytes: positive.default(1073741824),
    limits: LimitsSchema,
    trackers: z.record(z.string(), z.unknown()).default({}),
    repos: z.record(z.string(), z.unknown()),
  });
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
