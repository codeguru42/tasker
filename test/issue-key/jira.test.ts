import { describe, expect, it } from "vitest";
import { parseJiraKey } from "../../src/issue-key/jira.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";

describe("parseJiraKey", () => {
  it("parses a PROJ-N key", () => {
    expect(parseJiraKey("PROJ-123", "jira-repo")).toStrictEqual({
      key: "PROJ-123",
      repoKey: "jira-repo",
      shortRef: "PROJ-123",
    });
  });

  it("accepts digits and _ in the project", () => {
    expect(parseJiraKey("AB_2-1", "r")).toStrictEqual({
      key: "AB_2-1",
      repoKey: "r",
      shortRef: "AB_2-1",
    });
  });

  it.each([
    "",
    "PROJ",
    "PROJ-",
    "PROJ-0",
    "PROJ-01",
    "proj-1",
    "Proj-1",
    "1PROJ-1",
    "PROJ-1 ",
    " PROJ-1",
    "codeguru42/tasker#8",
  ])("rejects %j", (rawKey) => {
    let error: unknown;
    try {
      parseJiraKey(rawKey, "r");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(IssueKeyError);
    expect((error as IssueKeyError).key).toBe(rawKey);
    expect((error as IssueKeyError).message).toBe(
      `not a Jira issue key: ${JSON.stringify(rawKey)} (expected PROJ-N or <site>/browse/PROJ-N)`,
    );
  });
});
