import { describe, expect, it } from "vitest";
import { parseGithubKey } from "../../src/issue-key/github.js";
import { parseJiraKey } from "../../src/issue-key/jira.js";
import { isShortRef } from "../../src/issue-key/short-ref.js";

describe("isShortRef", () => {
  it.each([
    ["GitHub", parseGithubKey("codeguru42/tasker#17", "r").shortRef],
    ["Jira PROJ-12", parseJiraKey("PROJ-12", "r").shortRef],
    ["Jira A_B9-3", parseJiraKey("A_B9-3", "r").shortRef],
    [
      "Jira with a site",
      parseJiraKey("Acme.Atlassian.net/browse/PROJ-12", "r").shortRef,
    ],
    [
      "Jira with a hyphen in the site",
      parseJiraKey("x-y.example.com/browse/Q-1", "r").shortRef,
    ],
  ])("accepts the short ref of a parser result: %s", (_name, shortRef) => {
    expect(isShortRef(shortRef)).toBe(true);
  });

  it.each([
    "main",
    "master",
    "issue-0",
    "proj-12",
    "PROJ-012",
    "Acme.net-browse-PROJ-1",
  ])("refuses %s", (value) => {
    expect(isShortRef(value)).toBe(false);
  });
});
