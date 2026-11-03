import { describe, expect, it } from "vitest";
import { BaseHintError, type Issue } from "../../../src/issues/issue.js";
import { BaseBranchFieldError, jiraBaseBranchHint } from "../../../src/issues/jira/hint.js";
import { thrownBy } from "../../helpers/errors.js";
import { jiraRefOf } from "../../helpers/fake-acli.js";

const FIELD = "customfield_10001";

function issueWith(baseBranchField?: Issue["baseBranchField"], labels: string[] = []): Issue {
  return {
    ref: jiraRefOf("TEST-1"),
    title: "t",
    body: "",
    url: "https://example.atlassian.net/browse/TEST-1",
    labels,
    components: [],
    state: "open",
    comments: [],
    ...(baseBranchField === undefined ? {} : { baseBranchField }),
  };
}

const withValue = (value: unknown): Issue => issueWith({ id: FIELD, value });

describe("jiraBaseBranchHint", () => {
  it("gives no hint when the issue has no base branch field", () => {
    expect(jiraBaseBranchHint(issueWith())).toBeUndefined();
  });

  it.each([
    ["a missing key", undefined],
    ["null", null],
    ["an empty string", ""],
    ["white space only", "   "],
  ])("gives no hint for %s", (_name, value) => {
    expect(jiraBaseBranchHint(withValue(value))).toBeUndefined();
  });

  it.each(["release/1.2", " release/1.2 ", "origin/release/1.2"])("gives the string %j as it is", (value) => {
    expect(jiraBaseBranchHint(withValue(value))).toBe(value);
  });

  it("does not read a base: label", () => {
    expect(jiraBaseBranchHint(issueWith(undefined, ["base:main"]))).toBeUndefined();
  });

  it.each([{ value: "release/1.2" }, ["release/1.2"], 42, true])("throws for the value %j", (value) => {
    const error = thrownBy(() => jiraBaseBranchHint(withValue(value)));

    expect(error).toBeInstanceOf(BaseBranchFieldError);
    expect(error).toBeInstanceOf(BaseHintError);
    const typed = error as BaseBranchFieldError;
    expect(typed.fieldId).toBe(FIELD);
    expect(typed.labels).toEqual([]);
    expect(typed.message).toBe(
      `the base branch field ${FIELD} of the issue TEST-1 is not a string: ${JSON.stringify(value)}`,
    );
  });
});
