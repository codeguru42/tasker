import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readJiraIssue } from "../../../src/issues/jira/issue.js";
import { AcliError, AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { JiraSiteError } from "../../../src/issues/jira/site.js";
import { IssueReadError } from "../../../src/issues/issue.js";
import { failureOf } from "../../helpers/errors.js";
import { AUTH_STATUS_ARGS, fakeAcliView, jiraRefOf, MEASURED_NOT_FOUND } from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

// The output of `acli jira workitem view <key> --json --fields summary,description,labels,status,components`
// for three issues of the project TEST, as measured with acli 1.3.39-stable on 2026-10-25.
const TEST_2 = {
  changelog: null,
  editmeta: null,
  expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    components: [
      {
        id: "10000",
        name: "tasker-measure",
        self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/component/10000",
      },
    ],
    description: {
      content: [
        {
          content: [{ text: "An issue with labels and components for the measure of #543.", type: "text" }],
          type: "paragraph",
        },
      ],
      type: "doc",
      version: 1,
    },
    labels: ["base:main", "tasker-measure"],
    status: {
      description: "",
      iconUrl: "https://jira-prod-us-63-5.prod.atl-paas.net/images/icons/statuses/generic.png",
      id: "10006",
      name: "Backlog",
      self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/status/10006",
      statusCategory: {
        colorName: "blue-gray",
        id: 2,
        key: "new",
        name: "To Do",
        self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/statuscategory/2",
      },
    },
    summary: "tasker #543 measure: labels and components",
  },
  fieldsToInclude: null,
  id: "10004",
  key: "TEST-2",
  names: null,
  operations: null,
  properties: null,
  renderedFields: null,
  schema: null,
  self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/issue/10004",
  transitions: null,
  versionedRepresentations: null,
};

const TEST_3 = {
  changelog: null,
  editmeta: null,
  expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    components: [],
    description: null,
    labels: [],
    status: {
      description: "",
      iconUrl: "https://jira-prod-us-63-5.prod.atl-paas.net/images/icons/statuses/generic.png",
      id: "10006",
      name: "Backlog",
      self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/status/10006",
      statusCategory: {
        colorName: "blue-gray",
        id: 2,
        key: "new",
        name: "To Do",
        self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/statuscategory/2",
      },
    },
    summary: "tasker #543 measure: no description",
  },
  fieldsToInclude: null,
  id: "10005",
  key: "TEST-3",
  names: null,
  operations: null,
  properties: null,
  renderedFields: null,
  schema: null,
  self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/issue/10005",
  transitions: null,
  versionedRepresentations: null,
};

const TEST_4 = {
  changelog: null,
  editmeta: null,
  expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    components: [],
    description: null,
    labels: [],
    status: {
      description: "",
      iconUrl: "https://jira-prod-us-63-5.prod.atl-paas.net/images/icons/statuses/generic.png",
      id: "10005",
      name: "Done",
      self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/status/10005",
      statusCategory: {
        colorName: "green",
        id: 3,
        key: "done",
        name: "Done",
        self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/statuscategory/3",
      },
    },
    summary: "tasker #543 measure: status of the category done",
  },
  fieldsToInclude: null,
  id: "10006",
  key: "TEST-4",
  names: null,
  operations: null,
  properties: null,
  renderedFields: null,
  schema: null,
  self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/issue/10006",
  transitions: null,
  versionedRepresentations: null,
};

const BAD_FIELDS = "acli jira workitem view gave bad output for TEST-2: the fields do not match";

// The call of readJiraIssue(). The field list is a literal, so that the test checks the call on its own.
const viewArgs = (key: string) => [
  "jira",
  "workitem",
  "view",
  key,
  "--json",
  "--fields",
  "summary,description,labels,status,components",
];

// TEST-2 with the given changes in its fields. A value of undefined removes the field.
function test2With(changes: Record<string, unknown>): string {
  const fields = Object.entries({ ...TEST_2.fields, ...changes }).filter(([, value]) => value !== undefined);
  return JSON.stringify({ ...TEST_2, fields: Object.fromEntries(fields) });
}

describe("readJiraIssue", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-issue-");
  });

  const read = (key: string, stdout: string, site?: string) =>
    readJiraIssue(jiraRefOf(key), site, fakeAcliView(dir, viewArgs(key), { stdout }).env);

  it("reads an issue with labels and components", async () => {
    const fake = fakeAcliView(dir, viewArgs("TEST-2"), { stdout: JSON.stringify(TEST_2) });

    await expect(readJiraIssue(jiraRefOf("TEST-2"), undefined, fake.env)).resolves.toEqual({
      ref: jiraRefOf("TEST-2"),
      title: "tasker #543 measure: labels and components",
      body: "An issue with labels and components for the measure of #543.",
      url: "https://codeguru42.atlassian.net/browse/TEST-2",
      labels: ["base:main", "tasker-measure"],
      components: ["tasker-measure"],
      status: "Backlog",
      state: "open",
      comments: [],
    });
    expect(fake.calls()).toEqual([
      { args: AUTH_STATUS_ARGS, env: {} },
      { args: viewArgs("TEST-2"), env: {} },
    ]);
  });

  it("gives the url of the site that the guard gives", async () => {
    const issue = await read("TEST-2", JSON.stringify(TEST_2), "CODEGURU42.atlassian.net");

    expect(issue.url).toBe("https://codeguru42.atlassian.net/browse/TEST-2");
  });

  it("gives an empty body for an issue with no description", async () => {
    const issue = await read("TEST-3", JSON.stringify(TEST_3));

    expect(issue.body).toBe("");
  });

  it("reads an issue in a status of the category done as closed", async () => {
    const issue = await read("TEST-4", JSON.stringify(TEST_4));

    expect(issue.state).toBe("closed");
    expect(issue.status).toBe("Done");
  });

  it.each([
    ["the category indeterminate", { name: "In Progress", statusCategory: { key: "indeterminate" } }],
    ["a status with no category", { name: "Backlog" }],
  ])("gives open for %s", async (_label, status) => {
    const issue = await read("TEST-2", test2With({ status }));

    expect(issue.state).toBe("open");
  });

  it("reads an issue with no status and no description key", async () => {
    const issue = await read("TEST-2", test2With({ status: undefined, description: undefined }));

    expect(issue.state).toBe("open");
    expect(issue).not.toHaveProperty("status");
    expect(issue.body).toBe("");
  });

  it("gives no status for a status with no string name", async () => {
    const issue = await read("TEST-2", test2With({ status: { name: 5, statusCategory: { key: "done" } } }));

    expect(issue.status).toBeUndefined();
    expect(issue.state).toBe("closed");
  });

  it("drops a label that is not a string", async () => {
    const issue = await read("TEST-2", test2With({ labels: ["a", 1, null] }));

    expect(issue.labels).toEqual(["a"]);
  });

  it.each([
    ["null labels", null],
    ["missing labels", undefined],
  ])("gives no labels for %s", async (_label, labels) => {
    const issue = await read("TEST-2", test2With({ labels }));

    expect(issue.labels).toEqual([]);
  });

  it("drops a component with no string name", async () => {
    const issue = await read("TEST-2", test2With({ components: [{ name: "A" }, { id: "1" }, { name: 2 }, "B"] }));

    expect(issue.components).toEqual(["A"]);
  });

  it.each([
    ["null components", null],
    ["missing components", undefined],
  ])("gives no components for %s", async (_label, components) => {
    const issue = await read("TEST-2", test2With({ components }));

    expect(issue.components).toEqual([]);
  });

  it("fails with IssueReadError for an issue that does not exist", async () => {
    const fake = fakeAcliView(dir, viewArgs("TEST-999999"), { exitCode: 1, stderr: `${MEASURED_NOT_FOUND}\n` });

    const error = await failureOf(readJiraIssue(jiraRefOf("TEST-999999"), undefined, fake.env), IssueReadError);

    expect(error.message).toBe(
      `the issue TEST-999999 does not exist, or you do not have permission to see it: ${MEASURED_NOT_FOUND}`,
    );
  });

  it("passes another AcliError through", async () => {
    const fake = fakeAcliView(dir, viewArgs("TEST-2"), { exitCode: 1, stderr: "boom" });

    const error = await failureOf(readJiraIssue(jiraRefOf("TEST-2"), undefined, fake.env), AcliError);

    expect(error).not.toBeInstanceOf(IssueReadError);
    expect(error.stderr).toBe("boom");
    expect(error.exitCode).toBe(1);
  });

  it("passes an error of the site guard through", async () => {
    const fake = fakeAcliView(dir, viewArgs("TEST-2"), { stdout: JSON.stringify(TEST_2) });

    await failureOf(readJiraIssue(jiraRefOf("TEST-2"), "other.atlassian.net", fake.env), JiraSiteError);

    expect(fake.calls()).toEqual([{ args: AUTH_STATUS_ARGS, env: {} }]);
  });

  it("passes a missing acli through", async () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);

    await failureOf(readJiraIssue(jiraRefOf("TEST-2"), undefined, { PATH: empty }), AcliNotInstalledError);
  });

  it("fails when the output is not JSON", async () => {
    const error = await failureOf(read("TEST-2", "not json"), IssueReadError);

    expect(error.message).toBe("acli jira workitem view gave bad output for TEST-2: the output is not JSON");
  });

  it.each([
    ["no fields", JSON.stringify({ key: "TEST-2" })],
    ["a summary that is a number", test2With({ summary: 1 })],
    ["labels that are a string", test2With({ labels: "x" })],
    ["components that are an object", test2With({ components: {} })],
  ])("fails when the fields do not match for %s", async (_label, stdout) => {
    const error = await failureOf(read("TEST-2", stdout), IssueReadError);

    expect(error.message).toBe(BAD_FIELDS);
  });

  it("fails when the description is not an ADF document", async () => {
    const stdout = test2With({ description: { type: "paragraph", content: [] } });

    const error = await failureOf(read("TEST-2", stdout), IssueReadError);

    expect(error.message).toBe(
      'the description of TEST-2 is not an ADF document: the ADF document is a node of the type "paragraph"',
    );
  });
});
