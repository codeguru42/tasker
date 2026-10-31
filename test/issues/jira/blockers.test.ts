import { beforeEach, describe, expect, it } from "vitest";
import { IssueReadError } from "../../../src/issues/issue.js";
import { readJiraBlockers } from "../../../src/issues/jira/blockers.js";
import { AcliError, AcliNotInstalledError } from "../../../src/issues/jira/run.js";
import { JiraSiteError } from "../../../src/issues/jira/site.js";
import { failureOf } from "../../helpers/errors.js";
import {
  AUTH_STATUS_ARGS,
  fakeAcliView,
  jiraRefOf,
  linksViewArgs,
  MEASURED_NOT_FOUND,
} from "../../helpers/fake-acli.js";
import { useTempDir } from "../../helpers/temp.js";

const API = "https://jira-prod-us-63-5.prod.atl-paas.net";
const ISSUE_TYPE = {
  avatarId: 10318,
  description: "A small, distinct piece of work.",
  hierarchyLevel: 0,
  iconUrl: `${API}/rest/api/2/universal_avatar/view/type/issuetype/avatar/10318?size=medium`,
  id: "10006",
  name: "Task",
  self: `${API}/rest/api/3/issuetype/10006`,
  subtask: false,
};
const PRIORITY = {
  iconUrl: `${API}/images/icons/priorities/medium_new.svg`,
  id: "3",
  name: "Medium",
  self: `${API}/rest/api/3/priority/3`,
};
const BACKLOG = {
  description: "",
  iconUrl: `${API}/images/icons/statuses/generic.png`,
  id: "10006",
  name: "Backlog",
  self: `${API}/rest/api/3/status/10006`,
  statusCategory: {
    colorName: "blue-gray",
    id: 2,
    key: "new",
    name: "To Do",
    self: `${API}/rest/api/3/statuscategory/2`,
  },
};
const DONE = {
  description: "",
  iconUrl: `${API}/images/icons/statuses/generic.png`,
  id: "10005",
  name: "Done",
  self: `${API}/rest/api/3/status/10005`,
  statusCategory: {
    colorName: "green",
    id: 3,
    key: "done",
    name: "Done",
    self: `${API}/rest/api/3/statuscategory/3`,
  },
};
const BLOCKS = {
  id: "10000",
  inward: "is blocked by",
  name: "Blocks",
  outward: "blocks",
  self: `${API}/rest/api/3/issueLinkType/10000`,
};
const RELATES = {
  id: "10003",
  inward: "relates to",
  name: "Relates",
  outward: "relates to",
  self: `${API}/rest/api/3/issueLinkType/10003`,
};

// The output of `acli jira workitem view TEST-9 --json --fields issuelinks` for the issue TEST-9 of the
// project TEST, as measured with acli 1.3.39-stable on 2026-10-30. The links were made with
// `acli jira workitem link create`: TEST-9 is blocked by TEST-6 and TEST-4, TEST-9 blocks TEST-7,
// and TEST-9 relates to TEST-8.
const TEST_9 = {
  changelog: null,
  editmeta: null,
  expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
  fields: {
    issuelinks: [
      {
        id: "10004",
        inwardIssue: {
          fields: {
            issuetype: ISSUE_TYPE,
            priority: PRIORITY,
            status: BACKLOG,
            summary: "tasker #545 measure: open blocker",
          },
          id: "10008",
          key: "TEST-6",
          self: `${API}/rest/api/3/issue/10008`,
        },
        self: `${API}/rest/api/3/issueLink/10004`,
        type: BLOCKS,
      },
      {
        id: "10005",
        inwardIssue: {
          fields: {
            issuetype: ISSUE_TYPE,
            priority: PRIORITY,
            status: DONE,
            summary: "tasker #543 measure: status of the category done",
          },
          id: "10006",
          key: "TEST-4",
          self: `${API}/rest/api/3/issue/10006`,
        },
        self: `${API}/rest/api/3/issueLink/10005`,
        type: BLOCKS,
      },
      {
        id: "10006",
        outwardIssue: {
          fields: {
            issuetype: ISSUE_TYPE,
            priority: PRIORITY,
            status: BACKLOG,
            summary: "tasker #545 measure: blocked by subject",
          },
          id: "10009",
          key: "TEST-7",
          self: `${API}/rest/api/3/issue/10009`,
        },
        self: `${API}/rest/api/3/issueLink/10006`,
        type: BLOCKS,
      },
      {
        id: "10007",
        inwardIssue: {
          fields: {
            issuetype: ISSUE_TYPE,
            priority: PRIORITY,
            status: BACKLOG,
            summary: "tasker #545 measure: related to subject",
          },
          id: "10010",
          key: "TEST-8",
          self: `${API}/rest/api/3/issue/10010`,
        },
        self: `${API}/rest/api/3/issueLink/10007`,
        type: RELATES,
      },
    ],
  },
  fieldsToInclude: null,
  id: "10011",
  key: "TEST-9",
  names: null,
  operations: null,
  properties: null,
  renderedFields: null,
  schema: null,
  self: `${API}/rest/api/3/issue/10011`,
  transitions: null,
  versionedRepresentations: null,
};

const BAD_FIELDS = "acli jira workitem view gave bad output for TEST-9: the fields do not match";

type Link = Record<string, unknown>;

// The measured blocker link to TEST-6, the base of the other links.
const BLOCKER = TEST_9.fields.issuelinks[0] as Link;
// The measured link of the other direction: TEST-9 blocks TEST-7.
const OUTWARD = TEST_9.fields.issuelinks[2] as Link;
// The measured link of the type Relates.
const RELATED = TEST_9.fields.issuelinks[3] as Link;

// A link to the issue with this key and this status.
function blockerTo(key: string, status: unknown = BACKLOG): Link {
  return { ...BLOCKER, inwardIssue: { fields: { status }, key } };
}

// The link without one key.
const omit = (link: Link, name: string): Link =>
  Object.fromEntries(Object.entries(link).filter(([key]) => key !== name));

// TEST-9 with other links.
const test9With = (links: unknown): string => JSON.stringify({ ...TEST_9, fields: { issuelinks: links } });

describe("readJiraBlockers", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-jira-blockers-");
  });

  const read = (stdout: string, site?: string) =>
    readJiraBlockers(jiraRefOf("TEST-9"), site, fakeAcliView(dir, linksViewArgs("TEST-9"), { stdout }).env);

  const readLinks = (links: unknown) => read(test9With(links));

  it("makes the auth status call, then the view call", async () => {
    const fake = fakeAcliView(dir, linksViewArgs("TEST-9"), { stdout: JSON.stringify(TEST_9) });

    await readJiraBlockers(jiraRefOf("TEST-9"), undefined, fake.env);

    expect(fake.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS, linksViewArgs("TEST-9")]);
  });

  it("reads the measured blockers of TEST-9 in the order of the links", async () => {
    await expect(read(JSON.stringify(TEST_9))).resolves.toEqual([
      { key: "TEST-6", state: "open" },
      { key: "TEST-4", state: "closed" },
    ]);
  });

  describe("which links count", () => {
    it("counts a link of the name Blocks with another inward text", async () => {
      const type = { ...BLOCKS, inward: "is stopped by" };

      await expect(readLinks([{ ...BLOCKER, type }])).resolves.toEqual([{ key: "TEST-6", state: "open" }]);
    });

    it("counts a link of the inward text is blocked by with another name", async () => {
      const type = { ...BLOCKS, name: "Dependency" };

      await expect(readLinks([{ ...BLOCKER, type }])).resolves.toEqual([{ key: "TEST-6", state: "open" }]);
    });

    it.each([
      ["blocks", { ...BLOCKS, name: "blocks", inward: "x" }],
      ["Is Blocked By", { ...BLOCKS, name: "x", inward: "Is Blocked By" }],
      ["Relates", RELATES],
    ])("does not count a link of the type %s", async (_label, type) => {
      await expect(readLinks([{ ...BLOCKER, type }])).resolves.toEqual([]);
    });

    it("does not count a link with no type, or with a type that is not an object", async () => {
      const noType = omit(BLOCKER, "type");

      await expect(readLinks([noType, { ...BLOCKER, type: "Blocks" }, { ...BLOCKER, type: null }])).resolves.toEqual(
        [],
      );
    });

    it("does not count the measured outward link", async () => {
      await expect(readLinks([OUTWARD])).resolves.toEqual([]);
    });

    it("does not count a link with both sides", async () => {
      await expect(readLinks([{ ...BLOCKER, outwardIssue: OUTWARD.outwardIssue }])).resolves.toEqual([]);
    });

    it("counts a link with an outwardIssue of null and a real inwardIssue", async () => {
      await expect(readLinks([{ ...BLOCKER, outwardIssue: null }])).resolves.toEqual([
        { key: "TEST-6", state: "open" },
      ]);
    });

    it("does not count a link with an inwardIssue of null and a real outwardIssue", async () => {
      await expect(readLinks([{ ...OUTWARD, inwardIssue: null }])).resolves.toEqual([]);
    });

    it("does not count a link with no side", async () => {
      const noSide = omit(BLOCKER, "inwardIssue");

      await expect(readLinks([noSide, { ...BLOCKER, inwardIssue: null }])).resolves.toEqual([]);
    });

    it("does not check the issues of another link", async () => {
      const links = [
        { ...RELATED, inwardIssue: { key: 5 } },
        { ...OUTWARD, outwardIssue: { key: 5 } },
      ];

      await expect(readLinks(links)).resolves.toEqual([]);
    });
  });

  describe("the state of a blocker", () => {
    it.each([
      ["a category key other than done", { ...BACKLOG, statusCategory: { key: "indeterminate" } }],
      ["no statusCategory", { name: "Backlog" }],
      ["a statusCategory that is not an object", { statusCategory: "done" }],
    ])("is open for %s", async (_label, status) => {
      await expect(readLinks([blockerTo("TEST-3", status)])).resolves.toEqual([{ key: "TEST-3", state: "open" }]);
    });

    it("is open for an inward issue with no fields", async () => {
      const link = { ...BLOCKER, inwardIssue: { key: "TEST-3" } };

      await expect(readLinks([link])).resolves.toEqual([{ key: "TEST-3", state: "open" }]);
    });

    it("is open for an inward issue with no status", async () => {
      const link = { ...BLOCKER, inwardIssue: { fields: {}, key: "TEST-3" } };

      await expect(readLinks([link])).resolves.toEqual([{ key: "TEST-3", state: "open" }]);
    });

    it("is closed for the category key done", async () => {
      await expect(readLinks([blockerTo("TEST-3", DONE)])).resolves.toEqual([{ key: "TEST-3", state: "closed" }]);
    });
  });

  describe("the list", () => {
    it("lists two links to one key one time, at the first place", async () => {
      const links = [blockerTo("TEST-3"), blockerTo("TEST-5"), blockerTo("TEST-3", DONE)];

      await expect(readLinks(links)).resolves.toEqual([
        { key: "TEST-3", state: "open" },
        { key: "TEST-5", state: "open" },
      ]);
    });

    it("keeps the order of the links", async () => {
      const links = [blockerTo("TEST-8"), blockerTo("TEST-2", DONE), blockerTo("TEST-5")];

      await expect(readLinks(links)).resolves.toEqual([
        { key: "TEST-8", state: "open" },
        { key: "TEST-2", state: "closed" },
        { key: "TEST-5", state: "open" },
      ]);
    });

    it("gives a blocker of another project", async () => {
      await expect(readLinks([blockerTo("OTHER-7")])).resolves.toEqual([{ key: "OTHER-7", state: "open" }]);
    });

    it("gives [] for the measured issue with no links", async () => {
      await expect(readLinks([])).resolves.toEqual([]);
    });

    it("gives [] for an issue with no issuelinks", async () => {
      await expect(read(JSON.stringify({ ...TEST_9, fields: {} }))).resolves.toEqual([]);
    });
  });

  describe("the errors", () => {
    it("rejects an issue that does not exist", async () => {
      const fake = fakeAcliView(dir, linksViewArgs("TEST-999999"), { exitCode: 1, stderr: `${MEASURED_NOT_FOUND}\n` });

      const error = await failureOf(readJiraBlockers(jiraRefOf("TEST-999999"), undefined, fake.env), IssueReadError);

      expect(error.message).toBe(
        `the issue TEST-999999 does not exist, or you do not have permission to see it: ${MEASURED_NOT_FOUND}`,
      );
    });

    it("passes through another AcliError", async () => {
      const fake = fakeAcliView(dir, linksViewArgs("TEST-9"), { exitCode: 1, stderr: "boom" });

      const error = await failureOf(readJiraBlockers(jiraRefOf("TEST-9"), undefined, fake.env), AcliError);

      expect(error.stderr).toBe("boom");
    });

    it("passes through the error of the site guard, before the view call", async () => {
      const fake = fakeAcliView(dir, linksViewArgs("TEST-9"), { stdout: JSON.stringify(TEST_9) });

      await failureOf(readJiraBlockers(jiraRefOf("TEST-9"), "other.atlassian.net", fake.env), JiraSiteError);

      expect(fake.calls().map((call) => call.args)).toEqual([AUTH_STATUS_ARGS]);
    });

    it("passes through AcliNotInstalledError", async () => {
      const empty = useTempDir("tasker-jira-blockers-empty-");

      await failureOf(readJiraBlockers(jiraRefOf("TEST-9"), undefined, { PATH: empty }), AcliNotInstalledError);
    });

    it("rejects output that is not JSON", async () => {
      const error = await failureOf(read("not json"), IssueReadError);

      expect(error.message).toBe("acli jira workitem view gave bad output for TEST-9: the output is not JSON");
    });

    it.each([
      ["no fields", JSON.stringify({ key: "TEST-9" })],
      ["issuelinks as a string", JSON.stringify({ fields: { issuelinks: "none" } })],
      ["issuelinks of null", JSON.stringify({ fields: { issuelinks: null } })],
      ["a link that is a number", test9With([5])],
      ["a link that is null", test9With([null])],
      ["a link that is an array", test9With([[]])],
      ["a blocker with no key", test9With([{ ...BLOCKER, inwardIssue: {} }])],
      ["a blocker with a key that is a number", test9With([{ ...BLOCKER, inwardIssue: { key: 5 } }])],
      ["a blocker with the key test-3", test9With([blockerTo("test-3")])],
      ["a blocker with the key TEST-0", test9With([blockerTo("TEST-0")])],
      ["a blocker with the key TEST", test9With([blockerTo("TEST")])],
      ["a blocker with a key with a site", test9With([blockerTo("site.atlassian.net/browse/TEST-3")])],
      ["a blocker with an inwardIssue that is a string", test9With([{ ...BLOCKER, inwardIssue: "TEST-3" }])],
      ["a bad link after a good link", test9With([blockerTo("TEST-3"), blockerTo("TEST")])],
    ])("rejects bad fields: %s", async (_label, stdout) => {
      const error = await failureOf(read(stdout), IssueReadError);

      expect(error.message).toBe(BAD_FIELDS);
    });
  });
});
