import { z } from "zod";
import { splitGithubKey } from "../../issue-key/github.js";
import type { IssueRef } from "../../issue-key/ref.js";
import { type Issue, IssueReadError } from "../issue.js";
import { runGh } from "./run.js";

const ISSUE_VIEW_FIELDS = "number,title,body,url,labels,state";

// Not strict: a new field from gh passes.
const ViewSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  url: z.string(),
  labels: z.array(z.object({ name: z.string() })),
  state: z.string(),
});

export async function readGithubIssue(ref: IssueRef, account: string, env: NodeJS.ProcessEnv): Promise<Issue> {
  const parts = splitGithubKey(ref.key);
  const stdout = await runGh(["issue", "view", parts.number, "-R", parts.project, "--json", ISSUE_VIEW_FIELDS], {
    account,
    env,
  });

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
  // The path of an issue is /<owner>/<repo>/issues/<N>.
  const segments = url.pathname.split("/");
  if (segments.length !== 5 || segments[0] !== "" || segments[3] !== "issues") {
    throw bad(`the url is not an issue url: ${view.url}`);
  }

  if (view.number !== Number(parts.number)) throw bad(`gh gave the number ${view.number}`);

  let state: Issue["state"];
  if (view.state === "OPEN") state = "open";
  else if (view.state === "CLOSED") state = "closed";
  else throw bad(`unknown state ${JSON.stringify(view.state)}`);

  return {
    ref,
    title: view.title,
    body: view.body ?? "",
    url: view.url,
    labels: view.labels.map((label) => label.name),
    state,
  };
}
