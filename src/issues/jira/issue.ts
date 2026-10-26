import { z } from "zod";
import type { IssueRef } from "../../issue-key/ref.js";
import { isObject } from "../../object.js";
import { type Issue, IssueReadError } from "../issue.js";
import { AdfError, adfToText } from "./adf.js";
import { AcliError, runAcli } from "./run.js";
import { siteGuard } from "./site.js";

// The call names these fields because --fields replaces the default field list of acli.
const VIEW_FIELDS = "summary,description,labels,status,components";
const NOT_FOUND = "Issue does not exist";

// Not strict: a new field from acli passes. z.unknown() needs .optional() for a key that can be missing.
const ViewSchema = z.object({
  fields: z.object({
    summary: z.string(),
    description: z.unknown().optional(),
    labels: z.array(z.unknown()).nullish(),
    components: z.array(z.unknown()).nullish(),
    status: z.unknown().optional(),
  }),
});

// Reads one Jira issue. The site guard runs first. Each error that this function does not name passes through.
export async function readJiraIssue(ref: IssueRef, site: string | undefined, env: NodeJS.ProcessEnv): Promise<Issue> {
  const active = await siteGuard(ref.repoKey, site, env);
  let stdout: string;
  try {
    stdout = await runAcli(["jira", "workitem", "view", ref.key, "--json", "--fields", VIEW_FIELDS], { env });
  } catch (error) {
    if (error instanceof AcliError && error.stderr.includes(NOT_FOUND)) {
      throw new IssueReadError(
        ref.key,
        `the issue ${ref.key} does not exist, or you do not have permission to see it: ${error.stderr.trim()}`,
      );
    }
    throw error;
  }

  const bad = (reason: string) =>
    new IssueReadError(ref.key, `acli jira workitem view gave bad output for ${ref.key}: ${reason}`);

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw bad("the output is not JSON");
  }
  const parsed = ViewSchema.safeParse(json);
  if (!parsed.success) throw bad("the fields do not match");
  const fields = parsed.data.fields;

  let body: string;
  try {
    body = adfToText(fields.description);
  } catch (error) {
    if (error instanceof AdfError) {
      throw new IssueReadError(ref.key, `the description of ${ref.key} is not an ADF document: ${error.message}`);
    }
    throw error;
  }

  const status = isObject(fields.status) ? fields.status : undefined;
  const statusName = typeof status?.name === "string" ? status.name : undefined;
  const category = isObject(status?.statusCategory) ? status.statusCategory : undefined;

  return {
    ref,
    title: fields.summary,
    body,
    url: `https://${active}/browse/${ref.key}`,
    labels: (fields.labels ?? []).filter((label) => typeof label === "string"),
    components: (fields.components ?? []).flatMap((component) =>
      isObject(component) && typeof component.name === "string" ? [component.name] : [],
    ),
    ...(statusName === undefined ? {} : { status: statusName }),
    state: category?.key === "done" ? "closed" : "open",
    comments: [],
  };
}
