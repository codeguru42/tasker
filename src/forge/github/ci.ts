import type { GhSession } from "../../github/forge-session.js";
import type { CiStatus } from "../provider.js";

interface Source {
  name: string;
  collection: string;
  run: boolean;
}

const checks: Source = { name: "check runs", collection: "check_runs", run: true };
const statuses: Source = { name: "commit statuses", collection: "statuses", run: false };
const workflows: Source = { name: "workflow runs", collection: "workflow_runs", run: true };

type ResultState = "pending" | "passed" | "failed";

function malformed(sha: string, source: Source, field: string): Error {
  return new Error(`ciStatus for ${sha}: malformed ${source.name} response field ${field}`);
}

function commandFailure(sha: string, source: Source, cause: unknown): Error {
  const stderr =
    cause !== null && typeof cause === "object" && "stderr" in cause && typeof cause.stderr === "string"
      ? cause.stderr.trim()
      : "";
  const detail = stderr === "" ? "" : `: ${stderr}`;
  return new Error(`ciStatus for ${sha}: ${source.name} command failed${detail}`, { cause });
}

function readSource(
  session: GhSession,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  sha: string,
  source: Source,
): Promise<string> {
  return session.run(args, options).catch((error: unknown) => {
    throw commandFailure(sha, source, error);
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function responseResults(stdout: string, sha: string, source: Source): Record<string, unknown>[] {
  let pages: unknown;
  try {
    pages = JSON.parse(stdout);
  } catch {
    throw malformed(sha, source, "JSON");
  }
  if (!Array.isArray(pages)) throw malformed(sha, source, "pages");

  const results: Record<string, unknown>[] = [];
  for (const page of pages) {
    if (!isObject(page)) throw malformed(sha, source, "page");
    const collection = page[source.collection];
    if (!Array.isArray(collection)) throw malformed(sha, source, source.collection);
    for (const entry of collection) {
      if (!isObject(entry)) throw malformed(sha, source, `${source.collection} entry`);
      if (source.run) {
        if (typeof entry.status !== "string") throw malformed(sha, source, "status");
        if (entry.conclusion !== null && typeof entry.conclusion !== "string") {
          throw malformed(sha, source, "conclusion");
        }
      } else if (typeof entry.state !== "string") {
        throw malformed(sha, source, "state");
      }
      results.push(entry);
    }
  }
  return results;
}

function classifyRun(run: Record<string, unknown>): ResultState {
  if (run.status !== "completed") return "pending";
  return ["success", "neutral", "skipped"].includes(run.conclusion as string) ? "passed" : "failed";
}

function classifyStatus(status: Record<string, unknown>): ResultState {
  if (status.state === "success") return "passed";
  if (status.state === "pending") return "pending";
  return "failed";
}

function combinedStatus(results: ResultState[]): CiStatus {
  if (results.includes("failed")) return "failed";
  if (results.length === 0 || results.includes("pending")) return "pending";
  return "passed";
}

export async function ciStatus(
  session: GhSession,
  sha: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CiStatus> {
  const [checkStdout, statusStdout, workflowStdout] = await Promise.all([
    readSource(
      session,
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
      { cwd, env },
      sha,
      checks,
    ),
    readSource(
      session,
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
      { cwd, env },
      sha,
      statuses,
    ),
    readSource(
      session,
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
      { cwd, env },
      sha,
      workflows,
    ),
  ]);
  const checkRuns = responseResults(checkStdout, sha, checks);
  const commitStatuses = responseResults(statusStdout, sha, statuses);
  const workflowRuns = responseResults(workflowStdout, sha, workflows);
  return combinedStatus([
    ...checkRuns.map(classifyRun),
    ...commitStatuses.map(classifyStatus),
    ...workflowRuns.map(classifyRun),
  ]);
}
