import type { IssueRef } from "../../issue-key/ref.js";
import type { Blocker } from "../issue.js";

// Stub: the body comes in the next commit.
export async function readJiraBlockers(
  ref: IssueRef,
  site: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<Blocker[]> {
  throw new Error(
    `readJiraBlockers() is not done for ${ref.key} on ${site ?? "the active site"} (${Object.keys(env).length})`,
  );
}
