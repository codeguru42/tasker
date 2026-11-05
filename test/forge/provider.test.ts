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

export function checkReadonlyIdentity(provider: ForgeProvider): void {
  // @ts-expect-error id is readonly
  provider.id = "other";
  // @ts-expect-error account is readonly
  provider.account = "other";
}

void (0 as unknown as CiStatusIsExact);
void (0 as unknown as MergeMethodIsExact);
void (0 as unknown as PullRequestIsExact);
void (0 as unknown as OpenPullRequestIsExact);
void (0 as unknown as PrTargetIsExact);
void (0 as unknown as CreatePrInputIsExact);
void (0 as unknown as ProviderMethodsAreExact);
void (0 as unknown as ProviderIdentityIsExact);
void (0 as unknown as CiStatusArgs);
void (0 as unknown as IsPrMergedArgs);
void (0 as unknown as ListOpenPrsArgs);
void (0 as unknown as CreatePrArgs);
void (0 as unknown as MergePrArgs);
void (0 as unknown as CiStatusResult);
void (0 as unknown as IsPrMergedResult);
void (0 as unknown as ListOpenPrsResult);
void (0 as unknown as CreatePrResult);
void (0 as unknown as MergePrResult);
