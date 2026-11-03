import { describe, expect, it } from "vitest";
import { issueOf } from "./issue.js";
import { jiraRefOf } from "./fake-acli.js";

describe("issueOf", () => {
  it("gives the defaults and no key status or baseBranchField", () => {
    const issue = issueOf();

    expect(issue).toEqual({
      ref: { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" },
      title: "A title",
      body: "",
      url: "https://github.com/octo/repo/issues/7",
      labels: [],
      components: [],
      state: "open",
      comments: [],
    });
    expect(issue).not.toHaveProperty("status");
    expect(issue).not.toHaveProperty("baseBranchField");
  });

  it("lets the given fields win over the defaults", () => {
    const ref = jiraRefOf("TEST-1");

    const issue = issueOf({ labels: ["bug"], ref });

    expect(issue.labels).toEqual(["bug"]);
    expect(issue.ref).toBe(ref);
    expect(issue.title).toBe("A title");
    expect(issue.state).toBe("open");
  });

  it("gives no key for a field whose value is undefined", () => {
    expect(issueOf({ status: undefined })).not.toHaveProperty("status");
  });
});
