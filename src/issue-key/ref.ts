export interface IssueRef {
  // The native key of the issue.
  key: string;
  // The key of the configured repo, exactly as the caller passed it.
  repoKey: string;
  // One segment that is safe in a file path and in a git branch name.
  shortRef: string;
}

export class IssueKeyError extends Error {
  readonly key: string;

  constructor(key: string, message: string) {
    super(message);
    this.name = "IssueKeyError";
    this.key = key;
  }
}
