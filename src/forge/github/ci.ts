import type { GhSession } from "../../github/forge-session.js";
import type { CiStatus } from "../provider.js";

interface CheckRun {
  status?: unknown;
  conclusion?: unknown;
}

interface CommitStatus {
  state?: unknown;
}

interface WorkflowRun {
  status?: unknown;
  conclusion?: unknown;
}

function records(stdout: string, key: string): Record<string, unknown>[] {
  const pages: unknown = JSON.parse(stdout);
  if (!Array.isArray(pages)) throw new Error(`expected an array of ${key} pages`);
  return pages.flatMap((page: unknown) => {
    if (page === null || typeof page !== "object" || !(key in page)) {
      throw new Error(`expected ${key} in each page`);
    }
    const values = (page as Record<string, unknown>)[key];
    if (!Array.isArray(values)) throw new Error(`expected ${key} to be an array`);
    return values as Record<string, unknown>[];
  });
}

function passingRun(run: CheckRun | WorkflowRun): boolean {
  return run.status === "completed" && ["success", "neutral", "skipped"].includes(String(run.conclusion));
}

function hasPass(checkRuns: CheckRun[], statuses: CommitStatus[], workflowRuns: WorkflowRun[]): boolean {
  return (
    checkRuns.some(passingRun) || statuses.some((status) => status.state === "success") || workflowRuns.some(passingRun)
  );
}

export async function ciStatus(
  session: GhSession,
  sha: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<CiStatus> {
  const [checkStdout, statusStdout, workflowStdout] = await Promise.all([
    session.run(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`], {
      cwd,
      env,
    }),
    session.run(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`], {
      cwd,
      env,
    }),
    session.run(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`], {
      cwd,
      env,
    }),
  ]);
  const checkRuns = records(checkStdout, "check_runs") as CheckRun[];
  const statuses = records(statusStdout, "statuses") as CommitStatus[];
  const workflowRuns = records(workflowStdout, "workflow_runs") as WorkflowRun[];
  return hasPass(checkRuns, statuses, workflowRuns) ? "passed" : "pending";
}
