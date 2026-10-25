import { describe, expect, it } from "vitest";
import { parseGithubKey } from "../../src/issue-key/github.js";
import { parseJiraKey } from "../../src/issue-key/jira.js";
import { isShortRef } from "../../src/issue-key/short-ref.js";

describe("isShortRef", () => {
  it.each([
    ["GitHub", parseGithubKey("codeguru42/tasker#17", "r").shortRef],
    ["Jira PROJ-12", parseJiraKey("PROJ-12", "r").ref.shortRef],
    ["Jira A_B9-3", parseJiraKey("A_B9-3", "r").ref.shortRef],
    ["Jira with a site", parseJiraKey("Acme.Atlassian.net/browse/PROJ-12", "r").ref.shortRef],
    ["Jira with a hyphen in the site", parseJiraKey("x-y.example.com/browse/Q-1", "r").ref.shortRef],
    ["Jira with _ in the project and a site", parseJiraKey("jira.example.com/browse/PROJ_X-12", "r").ref.shortRef],
    ["Jira with -- in the site", parseJiraKey("xn--d.example.com/browse/Q-1", "r").ref.shortRef],
  ])("accepts the short ref of a parser result: %s", (_name, shortRef) => {
    expect(isShortRef(shortRef)).toBe(true);
  });

  it.each([
    ["GitHub", "issue-1"],
    ["a project", "PROJ-12"],
    ["a project with a former _", "A-B9-3"],
    ["a project with a part after a former _", "PROJ-X-12"],
    ["a one-label site", "jira-browse-AB-1"],
    ["a site with a - in a label", "x-y-example-com-browse-Q-1"],
    ["a site with a former --", "xn-d-example-com-browse-Q-1"],
    ["a site and a project with a part", "jira-example-com-browse-PROJ-X-12"],
  ])("accepts the form %s: %s", (_name, value) => {
    expect(isShortRef(value)).toBe(true);
  });

  it.each([
    "main",
    "master",
    "issue-0",
    "proj-12",
    "PROJ-012",
    "Acme.net-browse-PROJ-1",
    "A_B9-3",
    "PROJ_X-12",
    "jira_x-browse-AB-1",
    "acme.atlassian.net-browse-PROJ-12",
    "x-y.example.com-browse-Q-1",
    "jira.example.com-browse-PROJ-X-12",
    "issue-7.x",
    "PROJ--1",
    "a--b-browse-PROJ-1",
    "Acme-net-browse-PROJ-1",
  ])("refuses %s", (value) => {
    expect(isShortRef(value)).toBe(false);
  });
});
