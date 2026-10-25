import { z } from "zod";
import { splitGithubKey } from "../../issue-key/github.js";
import type { IssueRef } from "../../issue-key/ref.js";
import { type Issue, IssueReadError } from "../issue.js";
import { GhError, runGh } from "./run.js";

const ISSUE_VIEW_FIELDS = "number,title,body,url,labels,state";
const NOT_FOUND = "Could not resolve to an issue or pull request";

// Not strict: a new field from gh passes.
const ViewSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  url: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
});

// The state of an issue from the state that GitHub gives, or undefined for another state.
export function issueState(raw: string): Issue["state"] | undefined {
  if (raw === "OPEN") return "open";
  if (raw === "CLOSED") return "closed";
  return undefined;
}

// gh gives a pull request with exit code 0, in any state, so the read finds a pull request from the
// path of the url: /<owner>/<repo>/issues/<N> for an issue, /<owner>/<repo>/pull/<N> for a pull request.
export async function readGithubIssue(ref: IssueRef, account: string, env: NodeJS.ProcessEnv): Promise<Issue> {
  const parts = splitGithubKey(ref.key);
  let stdout: string;
  try {
    stdout = await runGh(["issue", "view", parts.number, "-R", parts.project, "--json", ISSUE_VIEW_FIELDS], {
      account,
      env,
    });
  } catch (error) {
    if (error instanceof GhError && error.stderr.includes(NOT_FOUND)) {
      throw new IssueReadError(ref.key, `the issue ${ref.key} does not exist: ${error.stderr.trim()}`);
    }
    throw error;
  }

  const bad = (reason: string) =>
    new IssueReadError(ref.key, `gh issue view gave bad output for ${ref.key}: ${reason}`);

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch {
    throw bad("the output is not JSON");
  }
  const parsed = ViewSchema.safeParse(json);
  if (!parsed.success) throw bad("the fields do not match");
  const view = parsed.data;

  let url: URL;
  try {
    url = new URL(view.url);
  } catch {
    throw bad("the url does not parse");
  }
  const segments = url.pathname.split("/");
  if (segments.length !== 5 || segments[0] !== "") throw bad(`the url is not an issue url: ${view.url}`);
  const kind = segments[3];
  if (kind === "pull") throw new IssueReadError(ref.key, `${ref.key} is a pull request, not an issue`);
  if (kind !== "issues") throw bad(`the url is not an issue url: ${view.url}`);

  if (view.number !== Number(parts.number)) throw bad(`gh gave the number ${view.number}`);

  const state = issueState(view.state);
  if (state === undefined) throw bad(`unknown state ${JSON.stringify(view.state)}`);

  return {
    ref,
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    labels: view.labels.map((label) => label.name),
    state,
    comments: [],
  };
}
