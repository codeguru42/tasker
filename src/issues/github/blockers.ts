import { z } from "zod";
import { asciiFold, splitGithubKey } from "../../issue-key/github.js";
import { IssueKeyError, type IssueRef } from "../../issue-key/ref.js";
import { type Blocker, IssueReadError } from "../issue.js";
import { issueState } from "./issue.js";
import { runGh } from "./run.js";

const QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { number state repository { nameWithOwner } }
      }
    }
  }
}`;

// Not strict: a new field from GitHub passes.
const AnswerSchema = z.object({
  data: z
    .object({
      repository: z
        .object({
          issue: z
            .object({
              blockedBy: z.object({
                pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
                nodes: z.array(
                  z.object({
                    number: z.number(),
                    state: z.string(),
                    repository: z.object({ nameWithOwner: z.string() }),
                  }),
                ),
              }),
            })
            .nullish(),
        })
        .nullish(),
    })
    .nullish(),
});

// Every issue that blocks the issue of ref, with its state, in the order that GitHub gives.
// Owner, name and cursor go as strings (-f): -F turns 123 or true into a number or a Boolean.
export async function readGithubBlockers(
  ref: IssueRef,
  account: string,
  env: NodeJS.ProcessEnv,
): Promise<Blocker[]> {
  const parts = splitGithubKey(ref.key);
  const [owner, name] = parts.project.split("/");
  const bad = (reason: string) =>
    new IssueReadError(ref.key, `gh api graphql gave bad output for ${ref.key}: ${reason}`);

  const args = [
    "api",
    "graphql",
    "-f",
    `query=${QUERY}`,
    "-f",
    `owner=${owner}`,
    "-f",
    `name=${name}`,
    "-F",
    `number=${parts.number}`,
  ];
  const stdout = await runGh(args, { account, env });

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw bad("the output is not JSON");
  }
  const parsed = AnswerSchema.safeParse(json);
  if (!parsed.success) throw bad("the fields do not match");
  const blockedBy = parsed.data.data?.repository?.issue?.blockedBy;
  if (blockedBy === undefined) throw bad("the fields do not match");

  const blockers: Blocker[] = [];
  for (const item of blockedBy.nodes) {
    const nameWithOwner = item.repository.nameWithOwner;
    const key =
      asciiFold(nameWithOwner) === asciiFold(parts.project)
        ? `${parts.project}#${item.number}`
        : `${nameWithOwner}#${item.number}`;
    try {
      splitGithubKey(key);
    } catch (error) {
      if (error instanceof IssueKeyError) throw bad(`not a GitHub issue key: ${JSON.stringify(key)}`);
      throw error;
    }
    const state = issueState(item.state);
    if (state === undefined) throw bad(`unknown state ${JSON.stringify(item.state)}`);
    blockers.push({ key, state });
  }
  return blockers;
}
