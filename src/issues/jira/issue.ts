import { z } from "zod";
import type { IssueRef } from "../../issue-key/ref.js";
import { isObject } from "../../object.js";
import { type Issue, IssueReadError } from "../issue.js";
import { AdfError, adfToText } from "./adf.js";
import { siteGuard } from "./site.js";
import { stateOfStatus, viewWorkitem } from "./view.js";

// The call names these fields because --fields replaces the default field list of acli.
const VIEW_FIELDS = "summary,description,labels,status,components";

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
  const { fields } = await viewWorkitem(ref.key, VIEW_FIELDS, ViewSchema, env);

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
    state: stateOfStatus(status),
    comments: [],
  };
}
