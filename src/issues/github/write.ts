import { splitGithubKey } from "../../issue-key/github.js";
import type { IssueRef } from "../../issue-key/ref.js";
import type { RepoConfig } from "../../config/schema.js";
import { IssueWriteError } from "../issue.js";
import { GhError, runGh } from "./run.js";

// Assigns the issue of ref to assignee with one gh call. gh resolves "@me" to the user of the token.
export async function assignGithubIssue(
  ref: IssueRef,
  assignee: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parts = splitGithubKey(ref.key);
  await runGh(["issue", "edit", parts.number, "-R", parts.project, "--add-assignee", assignee], { account, env });
}

// Moves an existing issue card to a single-select option on a Projects board.
export async function moveGithubCard(
  ref: IssueRef,
  board: NonNullable<RepoConfig["issueTracker"]["board"]>,
  option: string,
  configKey: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parts = splitGithubKey(ref.key);
  try {
    await runGh(
      [
        "project",
        "item-edit",
        String(board.number),
        "--owner",
        board.owner,
        "--url",
        `https://github.com/${parts.project}/issues/${parts.number}`,
        "--field",
        board.field,
        "--value",
        option,
      ],
      { account, env },
    );
  } catch (error) {
    if (error instanceof GhError && error.subcommand === "project item-edit") {
      throw new IssueWriteError(
        ref.key,
        configKey,
        `could not move the card of ${ref.key} to ${JSON.stringify(option)} on ${configKey}: ${error.message}`,
      );
    }
    throw error;
  }
}

// Adds or removes label on the issue of ref with one gh call. A failed issue edit call gives an
// IssueWriteError that names configKey. A failed token call passes as it is.
async function editLabel(
  flag: "--add-label" | "--remove-label",
  ref: IssueRef,
  label: string,
  configKey: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const parts = splitGithubKey(ref.key);
  try {
    await runGh(["issue", "edit", parts.number, "-R", parts.project, flag, label], { account, env });
  } catch (error) {
    if (error instanceof GhError && error.subcommand === "issue edit") {
      const action =
        flag === "--add-label"
          ? `add the label ${JSON.stringify(label)} of ${configKey} to`
          : `remove the label ${JSON.stringify(label)} of ${configKey} from`;
      throw new IssueWriteError(ref.key, configKey, `could not ${action} ${ref.key}: ${error.message}`);
    }
    throw error;
  }
}

// Adds the in-progress label to the issue of ref.
export function markGithubInProgress(
  ref: IssueRef,
  label: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return editLabel("--add-label", ref, label, "issueTracker.inProgressLabel", account, env);
}

// Adds the review label to the issue of ref.
export function markGithubReview(ref: IssueRef, label: string, account: string, env: NodeJS.ProcessEnv): Promise<void> {
  return editLabel("--add-label", ref, label, "issueTracker.reviewLabel", account, env);
}

// Removes the in-progress label from the issue of ref. gh does not read the labels of the issue first, so it has no
// separate path for an issue that does not have the label.
export function clearGithubInProgress(
  ref: IssueRef,
  label: string,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return editLabel("--remove-label", ref, label, "issueTracker.inProgressLabel", account, env);
}

// With doneLabel, adds the label and the issue stays open. Else closes the issue as completed.
// gh issue close exits 0 for an issue that is already closed.
export async function markGithubDone(
  ref: IssueRef,
  doneLabel: string | undefined,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  if (doneLabel !== undefined) return editLabel("--add-label", ref, doneLabel, "issueTracker.doneLabel", account, env);
  const parts = splitGithubKey(ref.key);
  await runGh(["issue", "close", parts.number, "-R", parts.project, "--reason", "completed"], { account, env });
}
