import { asciiFold } from "../ascii-fold.js";
import type { IssueRef } from "../issue-key/ref.js";

// One comment of an issue.
export interface IssueComment {
  author: string; // the name of the author, as the tracker gives it
  created: string; // the time of the comment, as the string that the tracker gives
  body: string; // the text of the comment, in the form that the tracker gives
}

// One issue of a tracker.
export interface Issue {
  ref: IssueRef;
  title: string;
  body: string; // "" when the issue has no body
  url: string;
  labels: string[]; // the label names, as the tracker gives them
  components: string[]; // the component names, as the tracker gives them
  status?: string; // the name of the status, as the tracker gives it
  state: "open" | "closed";
  comments: IssueComment[]; // from the oldest to the newest, from each author
}

// One issue that blocks another issue.
export interface Blocker {
  key: string; // <owner>/<repo>#<N>
  state: Issue["state"];
}

// A read of one issue failed: the issue does not exist, it is a pull request, the answer of the tracker has errors, or the tracker gave bad output.
export class IssueReadError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "IssueReadError";
    this.key = key;
  }
}

// A label write to one issue failed. The error names the configuration key of the label.
export class IssueWriteError extends Error {
  readonly key: string;
  readonly configKey: string;

  constructor(key: string, configKey: string, message: string) {
    super(message);
    this.name = "IssueWriteError";
    this.key = key;
    this.configKey = configKey;
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
// spaces, tabs and line ends. The prefix matches without regard to case, because GitHub label
// names are unique without regard to case. Only the letters A to Z fold, with asciiFold() (see
// src/ascii-fold.ts for the reason). The text after the prefix keeps its case, because branch
// names use case. The function reads only issue and makes no tracker call. It does not check the
// hint as a branch name: the base branch resolve in src/vcs/git/ does that.
export function baseBranchHint(issue: Issue): string | undefined {
  const found = issue.labels.filter((label) => asciiFold(label.slice(0, BASE_PREFIX.length)) === BASE_PREFIX);
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

// True when label is set and the issue has it. The compare folds both names, because GitHub
// label names are unique without regard to case. It folds with asciiFold() (see
// src/ascii-fold.ts), because toLowerCase() maps some non-ASCII letters to ASCII letters.
export function inProgressMarker(issue: Issue, label: string | undefined): boolean {
  if (label === undefined) return false;
  const wanted = asciiFold(label);
  return issue.labels.some((name) => asciiFold(name) === wanted);
}
