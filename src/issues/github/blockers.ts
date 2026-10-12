import { z } from "zod";
import { asciiFold, splitGithubKey } from "../../issue-key/github.js";
import { IssueKeyError, type IssueRef } from "../../issue-key/ref.js";
import { type Blocker, IssueReadError } from "../issue.js";
import { issueState } from "./issue.js";
import { GhError, runGh } from "./run.js";

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

// The envelope of a GraphQL answer. data is checked later, after the errors.
const EnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

// The full shape of data. Not strict: a new field from GitHub passes.
const DataSchema = z.object({
  repository: z.object({
    issue: z.object({
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
    }),
  }),
});

// The field of a value that can be anything, or undefined when the value is not an object.
const field = (value: unknown, name: string): unknown =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>)[name] : undefined;

// gh exits 1 for a GraphQL error and prints the JSON answer on stdout. A failed call is a
// GraphQL answer only when its stdout is a JSON object with an own data key or an own errors key.
// Any other failure stays the GhError, for example an HTTP 401 with a JSON body, a signal or a login error.
async function runGraphql(args: string[], account: string, env: NodeJS.ProcessEnv): Promise<string> {
  try {
    return await runGh(args, { account, env });
  } catch (error) {
    if (error instanceof GhError && error.exitCode !== null && isGraphqlAnswer(error.stdout)) {
      return error.stdout;
    }
    throw error;
  }
}

// True when text is a JSON object with an own data key or an own errors key.
function isGraphqlAnswer(text: string): boolean {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return false;
  }
  return (
    typeof json === "object" &&
    json !== null &&
    !Array.isArray(json) &&
    (Object.hasOwn(json, "data") || Object.hasOwn(json, "errors"))
  );
}

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

  const baseArgs = [
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

  const blockers: Blocker[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const args = cursor === undefined ? baseArgs : [...baseArgs, "-f", `cursor=${cursor}`];
    const stdout = await runGraphql(args, account, env);

    let json: unknown;
    try {
      json = JSON.parse(stdout);
    } catch {
      throw bad("the output is not JSON");
    }
    const envelope = EnvelopeSchema.safeParse(json);
    if (!envelope.success) throw bad("the fields do not match");
    const { data, errors } = envelope.data;
    const messages = (errors ?? []).map((error) => error.message).join("; ");
    const repository = field(data, "repository");
    if (repository === null || field(repository, "issue") === null) {
      const detail = messages === "" ? "" : `: ${messages}`;
      throw new IssueReadError(ref.key, `the issue ${ref.key} does not exist${detail}`);
    }
    if (errors && errors.length > 0) {
      throw new IssueReadError(ref.key, `gh api graphql gave errors for ${ref.key}: ${messages}`);
    }
    const shape = DataSchema.safeParse(data);
    if (!shape.success) throw bad("the fields do not match");
    const { blockedBy } = shape.data.repository.issue;

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

    const { hasNextPage, endCursor } = blockedBy.pageInfo;
    if (!hasNextPage) return blockers;
    if (endCursor === null) throw bad("the page has a next page but no cursor");
    if (seen.has(endCursor)) throw bad(`the cursor ${JSON.stringify(endCursor)} came again`);
    seen.add(endCursor);
    cursor = endCursor;
  }
}
