import type { ForgeProvider, OpenPullRequest, CreatePrInput, PullRequest } from "../../src/forge/provider.js";

export interface ForgeCalls {
  listed: { cwd: string; head: string }[];
  created: CreatePrInput[];
}

export interface ForgeStub {
  provider: ForgeProvider;
  calls: ForgeCalls;
  failList(error: Error): void;
  failCreate(error: Error): void;
}

export function forgeStub(
  options: {
    id?: string;
    account?: string;
    openPrs?: OpenPullRequest[];
    createdPr?: PullRequest;
  } = {},
): ForgeStub {
  const calls: ForgeCalls = { listed: [], created: [] };
  let listError: Error | undefined;
  let createError: Error | undefined;
  const provider: ForgeProvider = {
    id: options.id ?? "test-forge",
    account: options.account ?? "test-account",
    async ciStatus() {
      return "pending";
    },
    async isPrMerged() {
      return false;
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
    async mergePr() {},
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
  };
}
