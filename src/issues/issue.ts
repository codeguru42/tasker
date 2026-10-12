import type { IssueRef } from "../issue-key/ref.js";

// One issue of a tracker.
export interface Issue {
  ref: IssueRef;
  title: string;
  body: string; // "" when the issue has no body
  url: string;
  labels: string[]; // the label names, as the tracker gives them
  state: "open" | "closed";
}

// A read of one issue failed: the issue does not exist, it is a pull request, or the tracker gave bad output.
export class IssueReadError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "IssueReadError";
    this.key = key;
  }
}

// The base: labels of an issue give no usable base branch hint.
export class BaseHintError extends Error {
  readonly labels: string[];

  constructor(labels: string[], message: string) {
    super(message);
    this.name = "BaseHintError";
    this.labels = labels;
  }
}

const BASE_PREFIX = "base:";

// The base branch hint of issue: the text after "base:" of its one base: label, without the
// white space that String.prototype.trim() removes at the start and the end, for example
// spaces, tabs and line ends. The prefix is matched with case. The function reads only issue
// and makes no tracker call. It does not check the hint as a branch name: the base branch
// resolve in src/vcs/git/ does that.
export function baseBranchHint(issue: Issue): string | undefined {
  const found = issue.labels.filter((label) => label.startsWith(BASE_PREFIX));
  if (found.length === 0) return undefined;
  if (found.length > 1) {
    const names = found.map((label) => JSON.stringify(label)).join(", ");
    throw new BaseHintError(found, `the issue ${issue.ref.key} has more than one base: label: ${names}`);
  }
  const hint = found[0].slice(BASE_PREFIX.length).trim();
  if (hint === "") {
    throw new BaseHintError(
      found,
      `the base: label of the issue ${issue.ref.key} names no branch: ${JSON.stringify(found[0])}`,
    );
  }
  return hint;
}
