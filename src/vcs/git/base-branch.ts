const REMOTE_PREFIXES = ["refs/remotes/origin/", "origin/"];
const LOCAL_PREFIX = "refs/heads/";

// Parses the base branch that a user types. The result is the stored form:
// the name of an origin branch, or refs/heads/<x> for a local branch of the clone.
export function parseBaseInput(input: string): string {
  const prefix = REMOTE_PREFIXES.find((candidate) => input.startsWith(candidate));
  const name = prefix === undefined ? input : input.slice(prefix.length);
  if (name === "" || name === LOCAL_PREFIX) {
    throw new Error("the base branch is empty");
  }
  if (prefix !== undefined && name.startsWith(LOCAL_PREFIX)) {
    throw new Error(`the base branch is not a branch name: ${input}`);
  }
  return name;
}
