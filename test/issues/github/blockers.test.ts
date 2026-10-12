import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IssueKeyError, type IssueRef } from "../../../src/issue-key/ref.js";
import { readGithubBlockers } from "../../../src/issues/github/blockers.js";
import { IssueReadError } from "../../../src/issues/issue.js";
import { failureOf, fakeGh, ghTokenAnswer, makeTempDir } from "../../helpers.js";

// The query of readGithubBlockers(). It is a literal, so that the test checks the query on its own.
const QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      blockedBy(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { number state repository { nameWithOwner } }
      }
    }
  }
}`;

// The call of readGithubBlockers(). Owner, name and cursor go as strings (-f), the number as an Int (-F).
// The first page has no cursor argument.
const graphqlArgs = (owner: string, name: string, number: string, cursor?: string) => [
  "api",
  "graphql",
  "-f",
  `query=${QUERY}`,
  "-f",
  `owner=${owner}`,
  "-f",
  `name=${name}`,
  "-F",
  `number=${number}`,
  ...(cursor === undefined ? [] : ["-f", `cursor=${cursor}`]),
];

// One blocker node, as GitHub gives it.
const node = (number: number, state: string, nameWithOwner: string) => ({
  number,
  state,
  repository: { nameWithOwner },
});

// The JSON that gh prints for one page of blockers.
function pageJson(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
): string {
  return JSON.stringify({ data: { repository: { issue: { blockedBy: { pageInfo, nodes } } } } });
}

const ref: IssueRef = { key: "octo/repo#7", repoKey: "octo/repo", shortRef: "issue-7" };

describe("readGithubBlockers", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-read-blockers-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // A fake gh with the answer of the token call and the answers of the graphql calls.
  function fakeWith(...answers: Parameters<typeof fakeGh>[2][number][]) {
    return fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), ...answers]);
  }

  it("reads the blockers of one page in the order of GitHub", async () => {
    const fake = fakeWith({
      args: graphqlArgs("octo", "repo", "7"),
      stdout: pageJson([node(3, "OPEN", "octo/repo"), node(9, "CLOSED", "other/lib")]),
    });
    await expect(readGithubBlockers(ref, "octo", fake.env)).resolves.toEqual([
      { key: "octo/repo#3", state: "open" },
      { key: "other/lib#9", state: "closed" },
    ]);
  });

  it("gives an empty list for an issue with no blockers", async () => {
    const fake = fakeWith({ args: graphqlArgs("octo", "repo", "7"), stdout: pageJson([]) });
    await expect(readGithubBlockers(ref, "octo", fake.env)).resolves.toEqual([]);
  });

  it("keeps the spelling of the key for a blocker in the same project", async () => {
    const odd: IssueRef = { key: "Octo/Repo#7", repoKey: "tasker", shortRef: "issue-7" };
    const fake = fakeWith({
      args: graphqlArgs("Octo", "Repo", "7"),
      stdout: pageJson([node(5, "OPEN", "octo/repo")]),
    });
    await expect(readGithubBlockers(odd, "octo", fake.env)).resolves.toEqual([{ key: "Octo/Repo#5", state: "open" }]);
  });

  it("does not take a name with the Kelvin sign for the project", async () => {
    // The Kelvin sign U+212A is not an ASCII letter, so the name is another project, and it is not a GitHub name.
    const kit: IssueRef = { key: "octo/kit#7", repoKey: "octo/kit", shortRef: "issue-7" };
    const fake = fakeWith({
      args: graphqlArgs("octo", "kit", "7"),
      stdout: pageJson([node(5, "OPEN", "octo/Kit")]),
    });
    const error = await failureOf(readGithubBlockers(kit, "octo", fake.env), IssueReadError);
    expect(error.key).toBe("octo/kit#7");
    expect(error.message).toContain("gh api graphql gave bad output for octo/kit#7:");
  });

  it("reads every page, with the cursor of the page before", async () => {
    const fake = fakeWith(
      {
        args: graphqlArgs("octo", "repo", "7"),
        stdout: pageJson([node(3, "OPEN", "octo/repo")], { hasNextPage: true, endCursor: "MQ" }),
      },
      {
        args: graphqlArgs("octo", "repo", "7", "MQ"),
        stdout: pageJson([node(9, "CLOSED", "other/lib")], { hasNextPage: false, endCursor: "Mg" }),
      },
    );
    await expect(readGithubBlockers(ref, "octo", fake.env)).resolves.toEqual([
      { key: "octo/repo#3", state: "open" },
      { key: "other/lib#9", state: "closed" },
    ]);
    expect(fake.calls().map((call) => call.args)).toEqual([
      ["auth", "token", "--hostname", "github.com", "--user", "octo"],
      graphqlArgs("octo", "repo", "7"),
      graphqlArgs("octo", "repo", "7", "MQ"),
    ]);
  });

  it.each([
    [
      "a page with more pages and no cursor",
      [{ hasNextPage: true, endCursor: null }],
    ],
    [
      "a second page that gives the same cursor again",
      [
        { hasNextPage: true, endCursor: "MQ" },
        { hasNextPage: true, endCursor: "MQ" },
      ],
    ],
  ])("gives bad output for %s", async (_name, pages) => {
    const answers = pages.map((pageInfo, index) => ({
      args: graphqlArgs("octo", "repo", "7", index === 0 ? undefined : pages[index - 1].endCursor ?? undefined),
      stdout: pageJson([], pageInfo),
    }));
    const fake = fakeWith(...answers);
    const error = await failureOf(readGithubBlockers(ref, "octo", fake.env), IssueReadError);
    expect(error.key).toBe("octo/repo#7");
    expect(error.message).toContain("gh api graphql gave bad output for octo/repo#7:");
  });

  it("runs the graphql call with the token of the account", async () => {
    const fake = fakeWith({ args: graphqlArgs("octo", "repo", "7"), stdout: pageJson([]) });
    await readGithubBlockers(ref, "octo", fake.env);
    const call = fake.calls().find((c) => c.args[0] === "api");
    expect(call?.ghToken).toBe("gho_test");
  });

  it.each(["PROJ-7", "octo/repo"])("throws an IssueKeyError for the key %s before gh starts", async (key) => {
    const bad: IssueRef = { key, repoKey: "octo/repo", shortRef: "issue-7" };
    const fake = fakeWith();
    const error = await failureOf(readGithubBlockers(bad, "octo", fake.env), IssueKeyError);
    expect(error.key).toBe(key);
    expect(fake.calls()).toEqual([]);
  });

  it.each(["octo/123#7", "octo/true#7"])("passes the name of the key %s as a string", async (key) => {
    const [project, number] = key.split("#");
    const [owner, name] = project.split("/");
    const odd: IssueRef = { key, repoKey: "octo/repo", shortRef: "issue-7" };
    const fake = fakeWith({ args: graphqlArgs(owner, name, number), stdout: pageJson([]) });
    await expect(readGithubBlockers(odd, "octo", fake.env)).resolves.toEqual([]);
  });
});
