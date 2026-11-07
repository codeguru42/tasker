import type {
  ForgeProvider,
  OpenPullRequest,
  CreatePrInput,
  PullRequest,
  MergeMethod,
} from "../../src/forge/provider.js";

export interface ForgeCalls {
  listed: { cwd: string; head: string }[];
  created: CreatePrInput[];
  ci: { sha: string; cwd: string }[];
  merged: { number: number; method: MergeMethod; headSha: string; cwd: string }[];
  queried: { number: number; cwd: string }[];
  order: ("query" | "merge")[];
}

export interface ForgeStub {
  provider: ForgeProvider;
  calls: ForgeCalls;
  failList(error: Error): void;
  failCreate(error: Error): void;
  failQuery(error: Error): void;
  failMerge(error: Error): void;
}

export function forgeStub(
  options: {
    id?: string;
    account?: string;
    openPrs?: OpenPullRequest[];
    createdPr?: PullRequest;
    mergedStatuses?: (boolean | Error)[];
  } = {},
): ForgeStub {
  const calls: ForgeCalls = { listed: [], created: [], ci: [], merged: [], queried: [], order: [] };
  let listError: Error | undefined;
  let createError: Error | undefined;
  let queryError: Error | undefined;
  let mergeError: Error | undefined;
  const statuses = [...(options.mergedStatuses ?? [])];
  const provider: ForgeProvider = {
    id: options.id ?? "test-forge",
    account: options.account ?? "test-account",
    async ciStatus(sha, cwd) {
      calls.ci.push({ sha, cwd });
      return "pending";
    },
    async isPrMerged(number, cwd) {
      calls.order.push("query");
      calls.queried.push({ number, cwd });
      if (queryError !== undefined) throw queryError;
      const status = statuses.shift() ?? false;
      if (status instanceof Error) throw status;
      return status;
    },
    async listOpenPrs(target) {
      calls.listed.push({ cwd: target.cwd, head: target.head });
      if (listError !== undefined) throw listError;
      return options.openPrs ?? [];
    },
    async createPr(target) {
      calls.created.push({ ...target });
      if (createError !== undefined) throw createError;
      return options.createdPr ?? { number: 42, url: "https://example.test/pull/42" };
    },
    async mergePr(number, method, headSha, cwd) {
      calls.order.push("merge");
      calls.merged.push({ number, method, headSha, cwd });
      if (mergeError !== undefined) throw mergeError;
    },
  };
  return {
    provider,
    calls,
    failList(error) {
      listError = error;
    },
    failCreate(error) {
      createError = error;
    },
    failQuery(error) {
      queryError = error;
    },
    failMerge(error) {
      mergeError = error;
    },
  };
}
