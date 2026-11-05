import type { OpenPullRequest, PrTarget } from "../provider.js";
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
      throw operationError(error, target.head);
    }

    let requests: GhOpenPullRequest[];
    try {
      requests = parseOpenPullRequests(response);
    } catch (error) {
      throw operationError(error, target.head);
    }

    if (BigInt(requests.length) < limit) {
      return requests
        .filter(({ isCrossRepository }) => !isCrossRepository)
        .map(({ number, url, baseRefName }) => ({ number, url, base: baseRefName }));
    }
    limit *= 2n;
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

function operationError(error: unknown, head: string): Error {
  const cause = error instanceof Error ? error : new Error(String(error));
  const stderr = "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr.trim() : "";
  const details = stderr !== "" && !cause.message.includes(stderr) ? `: ${stderr}` : "";
  return new Error(`could not list pull requests for head ${head}: ${cause.message}${details}`, { cause });
}
