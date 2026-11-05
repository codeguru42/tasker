import type { CreatePrInput, MergeMethod, OpenPullRequest, PrTarget, PullRequest } from "../provider.js";
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

export async function isPrMerged(
  session: GhSession,
  prNumber: number,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  let response: string;
  try {
    response = await session.run(["pr", "view", String(prNumber), "--json", "state"], { cwd, env });
  } catch (error) {
    throw operationError("read merged state", error, `of pull request ${prNumber}`);
  }

  try {
    const value: unknown = JSON.parse(response);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error("GitHub returned an invalid pull request state");
    }
    const state = (value as Record<string, unknown>).state;
    if (typeof state !== "string") throw new Error("GitHub returned an invalid pull request state");
    return state === "MERGED";
  } catch (error) {
    throw operationError("read merged state", error, `of pull request ${prNumber}`);
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
      let pathname: string;
      try {
        pathname = new URL(url).pathname;
      } catch {
        continue;
      }
      const numberMatch = /\/pull\/([1-9]\d*)\/?$/.exec(pathname);
      if (numberMatch === null) continue;
      const number = Number(numberMatch[1]);
      if (!Number.isSafeInteger(number)) continue;
      identities.set(url, { number, url });
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
