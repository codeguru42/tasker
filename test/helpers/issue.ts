import type { Issue } from "../../src/issues/issue.js";

// Builds an Issue for the tests. A given field wins over its default. A field whose value is undefined gives no key.
export function issueOf(fields: Partial<Issue> = {}): Issue {
  const issue = {
    ref: { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" },
    title: "A title",
    body: "",
    url: "https://github.com/octo/repo/issues/7",
    labels: [],
    components: [],
    state: "open",
    comments: [],
    ...fields,
  };
  return Object.fromEntries(Object.entries(issue).filter(([, value]) => value !== undefined)) as unknown as Issue;
}
