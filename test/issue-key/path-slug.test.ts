import { describe, expect, it } from "vitest";
import { pathSlug } from "../../src/issue-key/path-slug.js";

describe("pathSlug", () => {
  it.each([
    ["lower case", "abc", "abc"],
    ["upper case", "ABC", "ABC"],
    ["a digit", "a1b", "a1b"],
    ["-", "a-b", "a-b"],
    ["_", "a_b", "a-b"],
    ["/", "a/b", "a-b"],
    ["#", "a#b", "a-b"],
    [".", "a.b", "a-b"],
    ["a space", "a b", "a-b"],
    ["a multi-byte character", "aäb", "a-b"],
    ["an emoji", "a😀b", "a-b"],
    ["a run of several", "a._/# -b", "a-b"],
    ["a start with one", "/a", "a"],
    ["an end with one", "a#", "a"],
    ["both ends", "-.a.-", "a"],
    ["a .lock end", "x.lock", "x-lock"],
    ["a mixed-case repo key", "CodeGuru42/Tasker", "CodeGuru42-Tasker"],
    ["an issue key", "codeguru42/tasker#10", "codeguru42-tasker-10"],
    ["a dot in a name", "my repo.v2", "my-repo-v2"],
    ["a Jira key with a site", "jira.example.com/browse/PROJ_X-12", "jira-example-com-browse-PROJ-X-12"],
  ])("gives the slug for %s", (_label, input, expected) => {
    expect(pathSlug(input)).toBe(expected);
  });

  it.each(["", "///", "._-", "ä😀"])("throws for %j", (value) => {
    expect(() => pathSlug(value)).toThrow(`cannot make a path slug from ${JSON.stringify(value)}`);
  });
});
