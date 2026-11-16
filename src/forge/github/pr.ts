import type {
  CreatePrInput,
  MergeMethod,
  OpenPullRequest,
  PrState,
  PrTarget,
  PullRequest,
  PullRequestView,
} from "../provider.js";
import type { GhSession } from "../../github/forge-session.js";

interface GhOpenPullRequest {
  number: number;
  url: string;
  baseRefName: string;
  isCrossRepository: boolean;
}

export async function listOpenPrs(
  session: GhSession,
  target: Pick<PrTarget, "cwd" | "head">,
  env: NodeJS.ProcessEnv,
): Promise<OpenPullRequest[]> {
  let limit = 100n;

  while (true) {
    let response: string;
    try {
      response = await session.run(
        [
          "pr",
          "list",
          "--head",
          target.head,
          "--state",
          "open",
          "--json",
          "number,url,baseRefName,isCrossRepository",
          "--limit",
          String(limit),
        ],
        { cwd: target.cwd, env },
      );
    } catch (error) {
      throw operationError("list pull requests", error, `for head ${target.head}`);
    }

    let requests: GhOpenPullRequest[];
    try {
      requests = parseOpenPullRequests(response);
    } catch (error) {
      throw operationError("list pull requests", error, `for head ${target.head}`);
    }

    if (BigInt(requests.length) < limit) {
      return requests
        .filter(({ isCrossRepository }) => !isCrossRepository)
        .map(({ number, url, baseRefName }) => ({ number, url, base: baseRefName }));
    }
    limit *= 2n;
  }
}

export async function createPr(
  session: GhSession,
  target: CreatePrInput,
  env: NodeJS.ProcessEnv,
): Promise<PullRequest> {
  let response: string;
  try {
    response = await session.run(
      ["pr", "create", "--head", target.head, "--base", target.base, "--title", target.title, "--body", target.body],
      { cwd: target.cwd, env },
    );
  } catch (error) {
    throw operationError("create pull request", error, `for head ${target.head}`);
  }

  try {
    return pullRequestFromOutput(response);
  } catch (error) {
    throw operationError("create pull request", error, `for head ${target.head}`);
  }
}

interface PrFieldRead<T> {
  field: string;
  operation: string;
  invalid: string;
  isValid: (value: unknown) => value is T;
}

const MERGED_STATE: PrFieldRead<string> = {
  field: "state",
  operation: "read merged state",
  invalid: "GitHub returned an invalid pull request state",
  isValid: (value): value is string => typeof value === "string",
};

const DRAFT_STATE: PrFieldRead<boolean> = {
  field: "isDraft",
  operation: "read draft state",
  invalid: "GitHub returned an invalid draft state",
  isValid: (value): value is boolean => typeof value === "boolean",
};

interface PrViewRead<T> {
  // The value of --json.
  fields: string;
  // The words after "could not", for example "read merged state".
  operation: string;
  // The words before the PR number, for example "of pull request".
  subject: string;
  // The message for an answer of the wrong shape.
  invalid: string;
  // Reads the parsed object. undefined means the wrong shape.
  parse: (record: Record<string, unknown>) => T | undefined;
}

async function viewPrJson<T>(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
  read: PrViewRead<T>,
): Promise<T> {
  const subject = `${read.subject} ${prNumber}`;
  let response: string;
  try {
    response = await session.run(["pr", "view", String(prNumber), "--json", read.fields], { cwd, env });
  } catch (error) {
    throw operationError(read.operation, error, subject);
  }

  try {
    const value: unknown = JSON.parse(response);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(read.invalid);
    }
    const result = read.parse(value as Record<string, unknown>);
    if (result === undefined) {
      throw new Error(read.invalid);
    }
    return result;
  } catch (error) {
    throw operationError(read.operation, error, subject);
  }
}

async function viewPrField<T>(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
  read: PrFieldRead<T>,
): Promise<T> {
  return viewPrJson(session, prNumber, cwd, env, {
    fields: read.field,
    operation: read.operation,
    subject: "of pull request",
    invalid: read.invalid,
    parse: (record) => {
      const value = record[read.field];
      return read.isValid(value) ? value : undefined;
    },
  });
}

export async function isPrMerged(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  return (await viewPrField(session, prNumber, cwd, env, MERGED_STATE)) === "MERGED";
}

export async function isPrDraft(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  return viewPrField(session, prNumber, cwd, env, DRAFT_STATE);
}

export async function markPrReady(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await session.run(["pr", "ready", String(prNumber)], { cwd, env });
  } catch (error) {
    throw operationError("take", error, `pull request ${prNumber} out of draft`);
  }
}

export async function mergePr(
  session: GhSession,
  prNumber: number,
  method: MergeMethod,
  headSha: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await session.run(["pr", "merge", String(prNumber), `--${method}`, "--match-head-commit", headSha], { cwd, env });
  } catch (error) {
    throw operationError("request merge", error, `of pull request ${prNumber}`);
  }
}

export async function changePrBase(
  session: GhSession,
  prNumber: number,
  base: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await session.run(["pr", "edit", String(prNumber), "--base", base], { cwd, env });
  } catch (error) {
    throw operationError("change the base", error, `of pull request ${prNumber}`);
  }
}

export async function viewPr(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<PullRequestView> {
  return viewPrJson(session, prNumber, cwd, env, {
    fields: "number,url,state,headRefName,baseRefName,isCrossRepository",
    operation: "read",
    subject: "pull request",
    invalid: "GitHub returned an invalid pull request",
    parse: pullRequestViewOf,
  });
}

const PR_STATES: Record<string, PrState> = { OPEN: "open", CLOSED: "closed", MERGED: "merged" };

function pullRequestViewOf(view: Record<string, unknown>): PullRequestView | undefined {
  const { number, url, state, headRefName, baseRefName, isCrossRepository } = view;
  if (
    typeof number !== "number" ||
    !Number.isInteger(number) ||
    number <= 0 ||
    typeof url !== "string" ||
    typeof state !== "string" ||
    !Object.hasOwn(PR_STATES, state) ||
    typeof headRefName !== "string" ||
    typeof baseRefName !== "string" ||
    typeof isCrossRepository !== "boolean"
  ) {
    return undefined;
  }
  return {
    number,
    url,
    state: PR_STATES[state],
    head: headRefName,
    base: baseRefName,
    crossRepository: isCrossRepository,
  };
}

function parseOpenPullRequests(response: string): GhOpenPullRequest[] {
  let value: unknown;
  try {
    value = JSON.parse(response);
  } catch {
    throw new Error("GitHub returned invalid pull request JSON");
  }

  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid pull request list");

  const entries: unknown[] = value;
  return entries.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`GitHub returned an invalid pull request at index ${index}`);
    }
    const request = entry as Record<string, unknown>;
    const number = request.number;
    const url = request.url;
    const baseRefName = request.baseRefName;
    const isCrossRepository = request.isCrossRepository;
    if (
      typeof number !== "number" ||
      !Number.isInteger(number) ||
      number <= 0 ||
      typeof url !== "string" ||
      typeof baseRefName !== "string" ||
      typeof isCrossRepository !== "boolean"
    ) {
      throw new Error(`GitHub returned an invalid pull request at index ${index}`);
    }

    return {
      number,
      url,
      baseRefName,
      isCrossRepository,
    };
  });
}

function pullRequestFromOutput(output: string): PullRequest {
  const identities = new Map<string, PullRequest>();
  for (const line of output.split(/\r?\n/)) {
    const matches = line.match(/https?:\/\/[^\s]+/g) ?? [];
    for (const match of matches) {
      const url = match.trim().replace(/[.,;:!?]+$/, "");
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        continue;
      }
      const pathname = parsedUrl.pathname;
      const numberMatch = /^\/[^/]+\/[^/]+\/pull\/([1-9]\d*)\/?$/.exec(pathname);
      if (numberMatch === null) continue;
      const number = Number(numberMatch[1]);
      if (!Number.isSafeInteger(number)) continue;
      const identity = `${parsedUrl.host}${pathname.replace(/\/$/, "")}`;
      if (!identities.has(identity)) identities.set(identity, { number, url });
    }
  }

  if (identities.size === 0) throw new Error("GitHub did not return a pull request URL");
  if (identities.size > 1) throw new Error("GitHub returned conflicting pull request URLs");
  return identities.values().next().value!;
}

function operationError(operation: string, error: unknown, subject: string): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const stderr = "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr.trim() : "";
  const details = stderr !== "" && !cause.message.includes(stderr) ? `: ${stderr}` : "";
  return new Error(`could not ${operation} ${subject}: ${cause.message}${details}`, { cause });
}
