import { describe, expect, it } from "vitest";
import { JiraFieldError, lookupFieldId } from "../../../src/issues/jira/field-id.js";
import { JiraRestError, type JiraCredentials } from "../../../src/issues/jira/rest.js";
import { failureOf } from "../../helpers/errors.js";
import { fakeFetch } from "../../helpers/fake-fetch.js";

const SITE = "example.atlassian.net";
const URL_ISSUE = `https://${SITE}/rest/api/3/issue/TEST-1?expand=names`;
const credentials: JiraCredentials = { email: "user@example.com", token: "test-token" };

function lookup(fieldName: string, status: number, body: unknown): Promise<string> {
  const fake = fakeFetch([{ url: URL_ISSUE, status, body }]);
  return lookupFieldId("TEST-1", SITE, fieldName, credentials, { fetch: fake.fetch });
}

describe("lookupFieldId", () => {
  it("gives the id whose name is equal to the field name", async () => {
    const names = { summary: "Summary", customfield_10001: "Release Branch" };

    expect(await lookup("Release Branch", 200, { names })).toBe("customfield_10001");
  });

  it("rejects with JiraFieldError for a name with other case", async () => {
    const names = { customfield_10001: "Release Branch" };

    const error = await failureOf(lookup("release branch", 200, { names }), JiraFieldError);

    expect(error.message).toBe('the issue TEST-1 has no field with the name "release branch"');
  });

  it("rejects with JiraFieldError when two ids have the name", async () => {
    const names = { customfield_10001: "Release Branch", customfield_10002: "Release Branch" };

    const error = await failureOf(lookup("Release Branch", 200, { names }), JiraFieldError);

    expect(error.message).toBe(
      'the issue TEST-1 has more than one field with the name "Release Branch": customfield_10001, customfield_10002',
    );
  });

  it("rejects with JiraRestError when the reply has no object names", async () => {
    const error = await failureOf(lookup("Release Branch", 200, { names: null }), JiraRestError);

    expect(error.message).toBe("the Jira REST call for the issue TEST-1 on example.atlassian.net gave bad output");
  });

  it("rejects with JiraRestError for a 404", async () => {
    const error = await failureOf(lookup("Release Branch", 404, {}), JiraRestError);

    expect(error.status).toBe(404);
  });
});
