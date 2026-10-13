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

  it("accepts digits and _ in the project, and gives - in the short ref", () => {
    expect(parseJiraKey("AB_2-1", "r")).toStrictEqual({
      key: "AB_2-1",
      repoKey: "r",
      shortRef: "AB-2-1",
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

  it("parses a <site>/browse/PROJ-N key", () => {
    expect(
      parseJiraKey("example.atlassian.net/browse/PROJ-7", "r"),
    ).toStrictEqual({
      key: "example.atlassian.net/browse/PROJ-7",
      repoKey: "r",
      shortRef: "example-atlassian-net-browse-PROJ-7",
    });
  });

  it("stores the site in lower case", () => {
    expect(
      parseJiraKey("Example.Atlassian.NET/browse/PROJ-7", "r"),
    ).toStrictEqual({
      key: "example.atlassian.net/browse/PROJ-7",
      repoKey: "r",
      shortRef: "example-atlassian-net-browse-PROJ-7",
    });
  });

  it("gives - for each _ in the project of a site key", () => {
    expect(
      parseJiraKey("jira.example.com/browse/PROJ_X-12", "r"),
    ).toStrictEqual({
      key: "jira.example.com/browse/PROJ_X-12",
      repoKey: "r",
      shortRef: "jira-example-com-browse-PROJ-X-12",
    });
  });

  it("gives one - for a -- in the site", () => {
    expect(parseJiraKey("xn--d.example.com/browse/Q-1", "r")).toStrictEqual({
      key: "xn--d.example.com/browse/Q-1",
      repoKey: "r",
      shortRef: "xn-d-example-com-browse-Q-1",
    });
  });

  it("accepts a site with one label", () => {
    expect(parseJiraKey("jira/browse/AB-1", "r")).toStrictEqual({
      key: "jira/browse/AB-1",
      repoKey: "r",
      shortRef: "jira-browse-AB-1",
    });
  });

  it.each([
    "https://example.atlassian.net/browse/PROJ-7",
    "http://example.atlassian.net/browse/PROJ-7",
    "/browse/PROJ-7",
    "example.atlassian.net/browse/",
    "example.atlassian.net/PROJ-7",
    "example.atlassian.net/browse/PROJ-7/",
    "example.atlassian.net/browse/proj-7",
    "example.com/jira/browse/PROJ-7",
    "example.atlassian.net:8080/browse/PROJ-7",
    "a..b/browse/PROJ-7",
    "-x.com/browse/PROJ-7",
  ])("rejects the site form %j", (rawKey) => {
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
