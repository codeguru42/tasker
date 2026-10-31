import { asciiFold } from "../../ascii-fold.js";
import { isObject } from "../../object.js";
import type { IssueRef } from "../../issue-key/ref.js";
import { type Issue, IssueWriteError } from "../issue.js";
import { AcliError, runAcli } from "./run.js";
import { siteGuard } from "./site.js";

const BAD_OUTPUT = "acli gave bad output";
const NO_MESSAGE = "acli gave no message";

// acli exits with 0 for a refused write, so the JSON result tells if the write passed.
// Returns undefined for a passed write, else the text of the failure.
function failureOfResult(stdout: string): string | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return BAD_OUTPUT;
  }
  if (!isObject(value) || !Array.isArray(value.results) || value.results.length !== 1) return BAD_OUTPUT;
  const item: unknown = value.results[0];
  if (!isObject(item) || typeof item.status !== "string") return BAD_OUTPUT;
  if (item.status === "SUCCESS") return undefined;
  return typeof item.message === "string" ? item.message : NO_MESSAGE;
}

// The one place that makes the IssueWriteError of a Jira write. Each error that is not an AcliError passes through.
async function runWrite(
  args: readonly string[],
  ref: IssueRef,
  configKey: string,
  action: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  let stdout: string;
  try {
    stdout = await runAcli(args, { env });
  } catch (error) {
    if (error instanceof AcliError)
      throw new IssueWriteError(ref.key, configKey, `could not ${action}: ${error.message}`);
    throw error;
  }
  const failure = failureOfResult(stdout);
  if (failure !== undefined) throw new IssueWriteError(ref.key, configKey, `could not ${action}: ${failure}`);
}

// Assigns one Jira issue. The site guard runs first.
export async function assignJiraIssue(
  ref: IssueRef,
  assignee: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await siteGuard(ref.repoKey, site, env);
  await runWrite(
    ["jira", "workitem", "assign", "--key", ref.key, "--assignee", assignee, "--yes", "--json"],
    ref,
    "issueTracker.assignee",
    `assign ${ref.key} to ${JSON.stringify(assignee)}`,
    env,
  );
}

// Moves one Jira issue to a status with `acli jira workitem transition`. The site guard has run before.
function moveToStatus(ref: IssueRef, status: string, configKey: string, env: NodeJS.ProcessEnv): Promise<void> {
  return runWrite(
    ["jira", "workitem", "transition", "--key", ref.key, "--status", status, "--yes", "--json"],
    ref,
    configKey,
    `move ${ref.key} to the status ${JSON.stringify(status)} of ${configKey}`,
    env,
  );
}

// Moves one Jira issue to the in-progress status. The site guard runs first.
export async function markJiraInProgress(
  ref: IssueRef,
  status: string,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await siteGuard(ref.repoKey, site, env);
  await moveToStatus(ref, status, "issueTracker.inProgressStatus", env);
}

// Moves one Jira issue to the done status. The site guard runs first, then the check of the status.
export async function markJiraDone(
  ref: IssueRef,
  status: string | undefined,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await siteGuard(ref.repoKey, site, env);
  if (status === undefined) throw new Error("issueTracker.doneStatus is not set");
  await moveToStatus(ref, status, "issueTracker.doneStatus", env);
}

// True when the status of the issue is the configured in-progress status. The compare ignores the case of the
// ASCII letters. It makes no acli call.
export function jiraInProgressMarker(issue: Issue, status: string | undefined): boolean {
  if (status === undefined || issue.status === undefined) return false;
  return asciiFold(issue.status) === asciiFold(status);
}
