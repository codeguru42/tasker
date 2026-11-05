import { describe, expect, it } from "vitest";
import type {
  CiStatus,
  CreatePrInput,
  ForgeProvider,
  MergeMethod,
  OpenPullRequest,
  PrTarget,
  PullRequest,
} from "../../src/forge/provider.js";

type Equal<Actual, Expected> = [Actual] extends [Expected] ? ([Expected] extends [Actual] ? true : false) : false;
type Assert<Value extends true> = Value;

type CiStatusIsExact = Assert<Equal<CiStatus, "pending" | "passed" | "failed">>;
type MergeMethodIsExact = Assert<Equal<MergeMethod, "merge" | "squash" | "rebase">>;
type PullRequestIsExact = Assert<Equal<PullRequest, { number: number; url: string }>>;
type OpenPullRequestIsExact = Assert<Equal<OpenPullRequest, { number: number; url: string; base: string }>>;
type PrTargetIsExact = Assert<Equal<PrTarget, { cwd: string; head: string; base: string }>>;
type CreatePrInputIsExact = Assert<
  Equal<CreatePrInput, { cwd: string; head: string; base: string; title: string; body: string }>
>;

type ProviderMethodsAreExact = Assert<
  Equal<
    Pick<ForgeProvider, "ciStatus" | "isPrMerged" | "listOpenPrs" | "createPr" | "mergePr">,
    {
      ciStatus: (sha: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<CiStatus>;
      isPrMerged: (prNumber: number, cwd: string, env: NodeJS.ProcessEnv) => Promise<boolean>;
      listOpenPrs: (target: Pick<PrTarget, "cwd" | "head">, env: NodeJS.ProcessEnv) => Promise<OpenPullRequest[]>;
      createPr: (target: CreatePrInput, env: NodeJS.ProcessEnv) => Promise<PullRequest>;
      mergePr: (
        prNumber: number,
        method: MergeMethod,
        headSha: string,
        cwd: string,
        env: NodeJS.ProcessEnv,
      ) => Promise<void>;
    }
  >
>;
type ProviderIdentityIsExact = Assert<
  Equal<Pick<ForgeProvider, "id" | "account">, { readonly id: string; readonly account: string }>
>;

type CiStatusArgs = Assert<Equal<Parameters<ForgeProvider["ciStatus"]>, [string, string, NodeJS.ProcessEnv]>>;
type IsPrMergedArgs = Assert<Equal<Parameters<ForgeProvider["isPrMerged"]>, [number, string, NodeJS.ProcessEnv]>>;
type ListOpenPrsArgs = Assert<
  Equal<Parameters<ForgeProvider["listOpenPrs"]>, [Pick<PrTarget, "cwd" | "head">, NodeJS.ProcessEnv]>
>;
type CreatePrArgs = Assert<Equal<Parameters<ForgeProvider["createPr"]>, [CreatePrInput, NodeJS.ProcessEnv]>>;
type MergePrArgs = Assert<
  Equal<Parameters<ForgeProvider["mergePr"]>, [number, MergeMethod, string, string, NodeJS.ProcessEnv]>
>;
type CiStatusResult = Assert<Equal<ReturnType<ForgeProvider["ciStatus"]>, Promise<CiStatus>>>;
type IsPrMergedResult = Assert<Equal<ReturnType<ForgeProvider["isPrMerged"]>, Promise<boolean>>>;
type ListOpenPrsResult = Assert<Equal<ReturnType<ForgeProvider["listOpenPrs"]>, Promise<OpenPullRequest[]>>>;
type CreatePrResult = Assert<Equal<ReturnType<ForgeProvider["createPr"]>, Promise<PullRequest>>>;
type MergePrResult = Assert<Equal<ReturnType<ForgeProvider["mergePr"]>, Promise<void>>>;

type ContractAssertions = [
  CiStatusIsExact,
  MergeMethodIsExact,
  PullRequestIsExact,
  OpenPullRequestIsExact,
  PrTargetIsExact,
  CreatePrInputIsExact,
  ProviderMethodsAreExact,
  ProviderIdentityIsExact,
  CiStatusArgs,
  IsPrMergedArgs,
  ListOpenPrsArgs,
  CreatePrArgs,
  MergePrArgs,
  CiStatusResult,
  IsPrMergedResult,
  ListOpenPrsResult,
  CreatePrResult,
  MergePrResult,
];

describe("ForgeProvider type contract", () => {
  it("satisfies its compile-time assertions", () => {
    const assertions: ContractAssertions = [
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ];
    expect(assertions).toEqual(Array.from({ length: 18 }, () => true));
  });
});

export function checkReadonlyIdentity(provider: ForgeProvider): void {
  // @ts-expect-error id is readonly
  provider.id = "other";
  // @ts-expect-error account is readonly
  provider.account = "other";
}
