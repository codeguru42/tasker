import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readJiraIssue } from "../../../src/issues/jira/issue.js";
import { AcliError, AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { JiraSiteError } from "../../../src/issues/jira/site.js";
import { IssueReadError } from "../../../src/issues/issue.js";
import { failureOf } from "../../helpers/errors.js";
import {
  AUTH_STATUS_ARGS,
  AUTH_STATUS_CALLS,
  fakeAcliView,
  issueViewArgs,
  jiraRefOf,
  NO_COMMENTS_FIELD,
  MEASURED_NOT_FOUND,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

// The output of `acli jira workitem view <key> --json --fields summary,description,labels,status,components,comment`
// for three issues of the project TEST, as measured with acli 1.3.39-stable on 2026-10-25.
// The value of comment is the measured value of TEST-3 from 2026-10-31.
const TEST_2 = {
  changelog: null,
  editmeta: null,
  expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    comment: NO_COMMENTS_FIELD,
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
    comment: NO_COMMENTS_FIELD,
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
    comment: NO_COMMENTS_FIELD,
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

// TEST-2 with the given changes in its fields. A value of undefined removes the field.
function test2With(changes: Record<string, unknown>): string {
  const fields = Object.entries({ ...TEST_2.fields, ...changes }).filter(([, value]) => value !== undefined);
  return JSON.stringify({ ...TEST_2, fields: Object.fromEntries(fields) });
}

// One entry of fields.comment.comments in the measured form, with no personal field.
// A value of undefined in changes removes the key, as JSON.stringify() does.
function commentEntry(n: number, changes: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    author: { displayName: "Measure User" },
    body: {
      content: [{ content: [{ text: `measure comment ${n} of 60`, type: "text" }], type: "paragraph" }],
      type: "doc",
      version: 1,
    },
    created: "2026-10-31T09:24:37.609-0600",
    id: String(10000 + n - 1),
    jsdPublic: true,
    updateAuthor: { displayName: "Measure User" },
    updated: "2026-10-31T09:24:37.609-0600",
    ...changes,
  };
}

// The value of fields.comment for the given entries. The total is the count of all comments of the issue.
function commentField(entries: unknown[], total = entries.length): Record<string, unknown> {
  return {
    comments: entries,
    maxResults: entries.length,
    self: "https://jira-prod-us-63-5.prod.atl-paas.net/rest/api/3/issue/10013/comment",
    startAt: total - entries.length,
    total,
  };
}

// The measured body of comment 3: a paragraph with bold text and a bullet list.
const LIST_BODY = {
  content: [
    {
      content: [
        { text: "measure comment 3 of 60 ", type: "text" },
        { marks: [{ type: "strong" }], text: "bold", type: "text" },
      ],
      type: "paragraph",
    },
    {
      content: [{ content: [{ content: [{ text: "item one", type: "text" }], type: "paragraph" }], type: "listItem" }],
      type: "bulletList",
    },
  ],
  type: "doc",
  version: 1,
};

const BAD_BODY = { type: "paragraph", content: [] };

describe("readJiraIssue", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-issue-");
  });

  const read = (key: string, stdout: string, site?: string) =>
    readJiraIssue(jiraRefOf(key), site, fakeAcliView(dir, issueViewArgs(key), { stdout }).env);

  it("reads an issue with labels and components", async () => {
    const fake = fakeAcliView(dir, issueViewArgs("TEST-2"), { stdout: JSON.stringify(TEST_2) });

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
      { args: issueViewArgs("TEST-2"), env: {} },
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
    const fake = fakeAcliView(dir, issueViewArgs("TEST-999999"), { exitCode: 1, stderr: `${MEASURED_NOT_FOUND}\n` });

    const error = await failureOf(readJiraIssue(jiraRefOf("TEST-999999"), undefined, fake.env), IssueReadError);

    expect(error.message).toBe(
      `the issue TEST-999999 does not exist, or you do not have permission to see it: ${MEASURED_NOT_FOUND}`,
    );
  });

  it("passes another AcliError through", async () => {
    const fake = fakeAcliView(dir, issueViewArgs("TEST-2"), { exitCode: 1, stderr: "boom" });

    const error = await failureOf(readJiraIssue(jiraRefOf("TEST-2"), undefined, fake.env), AcliError);

    expect(error).not.toBeInstanceOf(IssueReadError);
    expect(error.stderr).toBe("boom");
    expect(error.exitCode).toBe(1);
  });

  it("passes an error of the site guard through", async () => {
    const fake = fakeAcliView(dir, issueViewArgs("TEST-2"), { stdout: JSON.stringify(TEST_2) });

    await failureOf(readJiraIssue(jiraRefOf("TEST-2"), "other.atlassian.net", fake.env), JiraSiteError);

    expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
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

  describe("comments", () => {
    const readComments = (comment: unknown) => read("TEST-2", test2With({ comment }));

    it("reads each comment in the order of the view", async () => {
      const entries = [
        commentEntry(1, { created: "2026-10-31T09:30:00.000-0600", author: { displayName: "Ann Example" } }),
        commentEntry(2, { created: "2026-10-31T09:10:00.000-0600" }),
        commentEntry(3, { created: "2026-10-31T09:20:00.000-0600" }),
      ];

      const issue = await readComments(commentField(entries));

      expect(issue.comments).toEqual([
        { author: "Ann Example", created: "2026-10-31T09:30:00.000-0600", body: "measure comment 1 of 60" },
        { author: "Measure User", created: "2026-10-31T09:10:00.000-0600", body: "measure comment 2 of 60" },
        { author: "Measure User", created: "2026-10-31T09:20:00.000-0600", body: "measure comment 3 of 60" },
      ]);
    });

    it("reads a comment body with a bullet list", async () => {
      const issue = await readComments(commentField([commentEntry(3, { body: LIST_BODY })]));

      expect(issue.comments[0]?.body).toBe("measure comment 3 of 60 bold\n\n- item one");
    });

    it.each([
      ["no author", undefined],
      ["a null author", null],
      ["a string author", "Measure User"],
      ["an author with no displayName", {}],
      ["an author with a number displayName", { displayName: 5 }],
      ["an author with an empty displayName", { displayName: "" }],
    ])("gives the author unknown for %s", async (_label, author) => {
      const issue = await readComments(commentField([commentEntry(1, { author })]));

      expect(issue.comments[0]?.author).toBe("unknown");
    });

    it("fails for comment 2 with a bad body", async () => {
      const entries = [commentEntry(1), commentEntry(2, { body: BAD_BODY })];

      const error = await failureOf(readComments(commentField(entries)), IssueReadError);

      expect(error.message).toBe(
        'comment 2 of TEST-2 is not an ADF document: the ADF document is a node of the type "paragraph"',
      );
    });

    it.each([
      ["no comment", undefined],
      ["a null comment", null],
      ["no comments", { ...commentField([]), comments: undefined }],
      ["comments that are not an array", { ...commentField([]), comments: {} }],
      ["no total", { ...commentField([]), total: undefined }],
      ["a string total", { ...commentField([]), total: "0" }],
      ["an entry that is not an object", commentField(["x"])],
      ["no created", commentField([commentEntry(1, { created: undefined })])],
      ["a number created", commentField([commentEntry(1, { created: 5 })])],
      ["no body", commentField([commentEntry(1, { body: undefined })])],
      ["a null body", commentField([commentEntry(1, { body: null })])],
    ])("fails when the fields do not match for %s", async (_label, comment) => {
      const error = await failureOf(readComments(comment), IssueReadError);

      expect(error.message).toBe(BAD_FIELDS);
    });

    it("fails for the measured short list", async () => {
      const entries = Array.from({ length: 100 }, (_, i) => commentEntry(i + 1));

      const error = await failureOf(readComments(commentField(entries, 1010)), IssueReadError);

      expect(error.message).toBe("acli gave 100 of 1010 comments for TEST-2");
    });

    it("fails for any short list", async () => {
      const entries = [commentEntry(1), commentEntry(2)];

      const error = await failureOf(readComments(commentField(entries, 3)), IssueReadError);

      expect(error.message).toBe("acli gave 2 of 3 comments for TEST-2");
    });

    it("reads all the comments of a long list", async () => {
      const entries = Array.from({ length: 150 }, (_, i) => commentEntry(i + 1));

      const issue = await readComments(commentField(entries));

      expect(issue.comments).toHaveLength(150);
    });

    it("keeps each entry of a list longer than total", async () => {
      const entries = [commentEntry(1), commentEntry(2), commentEntry(3)];

      const issue = await readComments(commentField(entries, 2));

      expect(issue.comments).toHaveLength(3);
    });

    it("reports a short list before a bad comment body", async () => {
      const entries = [commentEntry(1), commentEntry(2, { body: BAD_BODY })];

      const error = await failureOf(readComments(commentField(entries, 3)), IssueReadError);

      expect(error.message).toBe("acli gave 2 of 3 comments for TEST-2");
    });

    it("reports a bad description before a short list", async () => {
      const stdout = test2With({ description: BAD_BODY, comment: commentField([commentEntry(1)], 2) });

      const error = await failureOf(read("TEST-2", stdout), IssueReadError);

      expect(error.message).toBe(
        'the description of TEST-2 is not an ADF document: the ADF document is a node of the type "paragraph"',
      );
    });
  });

  describe("the base branch field", () => {
    const FIELD = "customfield_10001";
    const lookup = async () => FIELD;

    const readField = (
      stdout: string,
      fieldIdOf: (login: { site: string; email: string | undefined }) => Promise<string>,
    ) => {
      const fake = fakeAcliView(dir, issueViewArgs("TEST-2", FIELD), { stdout });
      return { fake, result: readJiraIssue(jiraRefOf("TEST-2"), undefined, fake.env, fieldIdOf) };
    };

    it("names the field id in the view call", async () => {
      const { fake, result } = readField(test2With({ [FIELD]: "release/1.2" }), lookup);

      await result;

      expect(fake.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, issueViewArgs("TEST-2", FIELD)]);
    });

    it("keeps a string value", async () => {
      const { result } = readField(test2With({ [FIELD]: "release/1.2" }), lookup);

      expect((await result).baseBranchField).toEqual({ id: FIELD, value: "release/1.2" });
    });

    it("keeps null", async () => {
      const { result } = readField(test2With({ [FIELD]: null }), lookup);

      expect((await result).baseBranchField).toEqual({ id: FIELD, value: null });
    });

    it("gives value undefined for a missing key", async () => {
      const { result } = readField(test2With({}), lookup);

      const field = (await result).baseBranchField;
      expect(field).toEqual({ id: FIELD, value: undefined });
      expect(field?.id).toBe(FIELD);
    });

    it("gives the login to the lookup and runs it before the view call", async () => {
      const seen: unknown[] = [];
      let viewCalls = -1;
      const { fake, result } = readField(test2With({ [FIELD]: "x" }), async (login) => {
        seen.push(login);
        viewCalls = fake.calls().length;
        return FIELD;
      });

      await result;

      expect(seen).toEqual([{ site: "codeguru42.atlassian.net", email: "user@example.com" }]);
      expect(viewCalls).toBe(1);
      expect(fake.calls().filter((call) => call.args[1] === "auth")).toEqual(AUTH_STATUS_CALLS);
    });

    it("rejects with the error of the lookup and makes no view call", async () => {
      const failure = new Error("lookup failed");
      const { fake, result } = readField(test2With({}), () => Promise.reject(failure));

      expect(await failureOf(result, Error)).toBe(failure);
      expect(fake.calls()).toEqual(AUTH_STATUS_CALLS);
    });

    it("makes no field list change and sets no key without a lookup", async () => {
      const fake = fakeAcliView(dir, issueViewArgs("TEST-2"), { stdout: test2With({ [FIELD]: "x" }) });

      const issue = await readJiraIssue(jiraRefOf("TEST-2"), undefined, fake.env);

      expect(issue).not.toHaveProperty("baseBranchField");
      expect(fake.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, issueViewArgs("TEST-2")]);
    });
  });
});
