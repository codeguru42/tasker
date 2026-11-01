import { z } from "zod";
import type { IssueRef } from "../../issue-key/ref.js";
import { isObject } from "../../object.js";
import { type Issue, type IssueComment, IssueReadError } from "../issue.js";
import { AdfError, adfToText } from "./adf.js";
import { siteGuard } from "./site.js";
import { stateOfStatus, viewWorkitem } from "./view.js";

// The call names these fields because --fields replaces the default field list of acli.
const VIEW_FIELDS = "summary,description,labels,status,components,comment";

// Not strict: a new field from acli passes. z.unknown() needs .optional() for a key that can be missing.
const ViewSchema = z.object({
  fields: z.object({
    summary: z.string(),
    description: z.unknown().optional(),
    labels: z.array(z.unknown()).nullish(),
    components: z.array(z.unknown()).nullish(),
    status: z.unknown().optional(),
    comment: z.object({
      comments: z.array(
        z.object({
          created: z.string(),
          body: z.unknown().refine((value) => value != null),
          author: z.unknown().optional(),
        }),
      ),
      total: z.number(),
    }),
  }),
});

type ViewComment = z.infer<typeof ViewSchema>["fields"]["comment"];

// Converts one ADF value to text. An AdfError becomes an IssueReadError that names the label. Each other error passes.
function adfTextOf(key: string, value: unknown, label: string): string {
  try {
    return adfToText(value);
  } catch (error) {
    if (error instanceof AdfError) {
      throw new IssueReadError(key, `${label} is not an ADF document: ${error.message}`);
    }
    throw error;
  }
}

// Maps the comments of the view, in the order of the view. The view gives no older comments than its own list,
// so a list that is shorter than the total fails. The first bad comment body stops the read.
function commentsOfView(key: string, comment: ViewComment): IssueComment[] {
  const { comments, total } = comment;
  if (comments.length < total) {
    throw new IssueReadError(key, `acli gave ${comments.length} of ${total} comments for ${key}`);
  }
  return comments.map((entry, index) => {
    const name = isObject(entry.author) ? entry.author.displayName : undefined;
    return {
      author: typeof name === "string" && name !== "" ? name : "unknown",
      created: entry.created,
      body: adfTextOf(key, entry.body, `comment ${index + 1} of ${key}`),
    };
  });
}

// Reads one Jira issue. The site guard runs first. Each error that this function does not name passes through.
export async function readJiraIssue(ref: IssueRef, site: string | undefined, env: NodeJS.ProcessEnv): Promise<Issue> {
  const active = await siteGuard(ref.repoKey, site, env);
  const { fields } = await viewWorkitem(ref.key, VIEW_FIELDS, ViewSchema, env);

  const body = adfTextOf(ref.key, fields.description, `the description of ${ref.key}`);

  const comments = commentsOfView(ref.key, fields.comment);

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
    comments,
  };
}
