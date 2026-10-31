import { z } from "zod";
import { parseJiraKey } from "../../issue-key/jira.js";
import { IssueKeyError, type IssueRef } from "../../issue-key/ref.js";
import { isObject } from "../../object.js";
import type { Blocker } from "../issue.js";
import { siteGuard } from "./site.js";
import { badViewFields, stateOfStatus, viewWorkitem } from "./view.js";

// Not strict: a new field from acli passes. A missing issuelinks is no links, but a value that is not an array is bad output.
const ViewSchema = z.object({ fields: z.object({ issuelinks: z.array(z.unknown()).optional() }) });

// The link means "the other issue blocks this issue" when it has an inwardIssue and no outwardIssue.
// Both compares of the type are exact.
function isBlockerLink(link: Record<string, unknown>): boolean {
  if (link.inwardIssue == null || link.outwardIssue != null) return false;
  return isObject(link.type) && (link.type.name === "Blocks" || link.type.inward === "is blocked by");
}

// True when the key has the form <PROJECT>-<N>, with no site.
function isPlainJiraKey(key: unknown, repoKey: string): key is string {
  if (typeof key !== "string") return false;
  try {
    return parseJiraKey(key, repoKey).site === undefined;
  } catch (error) {
    if (error instanceof IssueKeyError) return false;
    throw error;
  }
}

// Reads the issues that block one Jira issue, from its issue links. The site guard runs first.
// Each error that this function does not name passes through.
export async function readJiraBlockers(
  ref: IssueRef,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<Blocker[]> {
  await siteGuard(ref.repoKey, site, env);
  const { fields } = await viewWorkitem(ref.key, "issuelinks", ViewSchema, env);

  const blockers: Blocker[] = [];
  const seen = new Set<string>();
  for (const link of fields.issuelinks ?? []) {
    if (!isObject(link)) throw badViewFields(ref.key);
    if (!isBlockerLink(link)) continue;
    const inward = link.inwardIssue;
    if (!isObject(inward) || !isPlainJiraKey(inward.key, ref.repoKey)) throw badViewFields(ref.key);
    // The blocker step counts two entries of one key as two ready blockers, so a key comes one time.
    if (seen.has(inward.key)) continue;
    seen.add(inward.key);
    blockers.push({
      key: inward.key,
      state: stateOfStatus(isObject(inward.fields) ? inward.fields.status : undefined),
    });
  }
  return blockers;
}
