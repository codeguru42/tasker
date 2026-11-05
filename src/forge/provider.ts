export type CiStatus = "pending" | "passed" | "failed";

export type MergeMethod = "merge" | "squash" | "rebase";

export interface PullRequest {
  number: number;
  url: string;
}

export interface OpenPullRequest extends PullRequest {
  base: string;
}

export interface PrTarget {
  cwd: string;
  head: string;
  base: string;
}

export interface CreatePrInput extends PrTarget {
  title: string;
  body: string;
}

/**
 * Shared contract for a forge that hosts pull requests.
 *
 * Every failure rejects the returned promise. The provider uses the supplied
 * environment without changing it or the parent process environment. Each
 * repository operation uses the supplied worktree directory and finds the
 * repository from its `origin` remote, not from an issue key or tracker
 * configuration.
 *
 * The caller controls task state, persistence, branch publication, and time
 * limits. Before calling `createPr`, the caller chooses whether to adopt an
 * existing pull request. `mergePr` returns after the forge accepts the merge;
 * the caller uses `isPrMerged` to establish completion.
 */
export interface ForgeProvider {
  readonly id: string;
  readonly account: string;

  ciStatus(sha: string, cwd: string, env: NodeJS.ProcessEnv): Promise<CiStatus>;
  isPrMerged(prNumber: number, cwd: string, env: NodeJS.ProcessEnv): Promise<boolean>;
  listOpenPrs(target: Pick<PrTarget, "cwd" | "head">, env: NodeJS.ProcessEnv): Promise<OpenPullRequest[]>;
  createPr(target: CreatePrInput, env: NodeJS.ProcessEnv): Promise<PullRequest>;
  mergePr(prNumber: number, method: MergeMethod, headSha: string, cwd: string, env: NodeJS.ProcessEnv): Promise<void>;
}
