import type {
  ForgeProvider,
  OpenPullRequest,
  CreatePrInput,
  PullRequest,
  PullRequestView,
  MergeMethod,
} from "../../src/forge/provider.js";

export interface ForgeCalls {
  listed: { cwd: string; head: string }[];
  created: CreatePrInput[];
  ci: { sha: string; cwd: string }[];
  merged: { number: number; method: MergeMethod; headSha: string; cwd: string }[];
  baseChanged: { number: number; base: string; cwd: string }[];
  viewed: { number: number; cwd: string }[];
  queried: { number: number; cwd: string }[];
  draftQueried: { number: number; cwd: string }[];
  readied: { number: number; cwd: string }[];
  order: ("query" | "draft" | "ready" | "merge")[];
}

export interface ForgeStub {
  provider: ForgeProvider;
  calls: ForgeCalls;
  failList(error: Error): void;
  failCreate(error: Error): void;
  failQuery(error: Error): void;
  failMerge(error: Error): void;
  failBaseChange(error: Error): void;
  failDraftQuery(error: Error): void;
  failReady(error: Error): void;
  failView(error: Error): void;
}

export function forgeStub(
  options: {
    id?: string;
    account?: string;
    openPrs?: OpenPullRequest[];
    createdPr?: PullRequest;
    mergedStatuses?: (boolean | Error)[];
    draft?: boolean;
    viewedPr?: PullRequestView;
  } = {},
): ForgeStub {
  const calls: ForgeCalls = {
    listed: [],
    created: [],
    ci: [],
    merged: [],
    baseChanged: [],
    queried: [],
    draftQueried: [],
    readied: [],
    viewed: [],
    order: [],
  };
  let listError: Error | undefined;
  let createError: Error | undefined;
  let queryError: Error | undefined;
  let mergeError: Error | undefined;
  let baseChangeError: Error | undefined;
  let draftQueryError: Error | undefined;
  let readyError: Error | undefined;
  let viewError: Error | undefined;
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
    async changePrBase(number, base, cwd) {
      calls.baseChanged.push({ number, base, cwd });
      if (baseChangeError !== undefined) throw baseChangeError;
    },
    async isPrDraft(number, cwd) {
      calls.order.push("draft");
      calls.draftQueried.push({ number, cwd });
      if (draftQueryError !== undefined) throw draftQueryError;
      return options.draft ?? false;
    },
    async markPrReady(number, cwd) {
      calls.order.push("ready");
      calls.readied.push({ number, cwd });
      if (readyError !== undefined) throw readyError;
    },
    // @ts-expect-error viewPr is not on ForgeProvider yet
    async viewPr(number, cwd) {
      calls.viewed.push({ number, cwd });
      if (viewError !== undefined) throw viewError;
      return (
        options.viewedPr ?? {
          number: 42,
          url: "https://example.test/pull/42",
          base: "main",
          head: "branch",
          state: "open",
          crossRepository: false,
        }
      );
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
    failBaseChange(error) {
      baseChangeError = error;
    },
    failDraftQuery(error) {
      draftQueryError = error;
    },
    failReady(error) {
      readyError = error;
    },
    failView(error) {
      viewError = error;
    },
  };
}
