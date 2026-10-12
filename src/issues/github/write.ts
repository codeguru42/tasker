import { splitGithubKey } from "../../issue-key/github.js";
import type { IssueRef } from "../../issue-key/ref.js";
import { runGh } from "./run.js";

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
