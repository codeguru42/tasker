import { describe, expect, it } from "vitest";
import {
  JiraCredentialError,
  JiraRestError,
  jiraCredentials,
  jiraGet,
  type JiraCredentials,
} from "../../../src/issues/jira/rest.js";
import { failureOf, thrownBy } from "../../helpers/errors.js";
import { fakeFetch } from "../../helpers/fake-fetch.js";
import { expectNoFakeSecret, FAKE_BASIC_AUTH, FAKE_EMAIL, FAKE_TOKEN } from "../../helpers/fake-credentials.js";

const SITE = "example.atlassian.net";
const URL_MYSELF = `https://${SITE}/rest/api/3/myself`;
const credentials: JiraCredentials = { email: FAKE_EMAIL, token: FAKE_TOKEN };

describe("jiraCredentials", () => {
  it("lets TASKER_JIRA_TOKEN win over apiToken", () => {
    const result = jiraCredentials(
      { apiToken: "other", email: FAKE_EMAIL },
      { TASKER_JIRA_TOKEN: FAKE_TOKEN },
      undefined,
    );

    expect(result.token).toBe(FAKE_TOKEN);
  });

  it("falls back to apiToken when TASKER_JIRA_TOKEN is empty", () => {
    const result = jiraCredentials({ apiToken: FAKE_TOKEN }, { TASKER_JIRA_TOKEN: "" }, FAKE_EMAIL);

    expect(result.token).toBe(FAKE_TOKEN);
  });

  it("throws JiraCredentialError when no token exists", () => {
    const error = thrownBy(() => jiraCredentials({}, {}, FAKE_EMAIL));

    expect(error).toBeInstanceOf(JiraCredentialError);
    expect((error as Error).message).toBe("no Jira API token: set TASKER_JIRA_TOKEN or issueTracker.apiToken");
    expect((error as JiraCredentialError).missing).toBe("token");
  });

  it("takes the email from TASKER_JIRA_EMAIL first", () => {
    const env = { TASKER_JIRA_TOKEN: FAKE_TOKEN, TASKER_JIRA_EMAIL: "env@example.com" };

    expect(jiraCredentials({ email: "key@example.com" }, env, "acli@example.com").email).toBe("env@example.com");
  });

  it("falls back to apiToken when TASKER_JIRA_TOKEN is blank", () => {
    const result = jiraCredentials({ apiToken: FAKE_TOKEN }, { TASKER_JIRA_TOKEN: "  " }, FAKE_EMAIL);

    expect(result.token).toBe(FAKE_TOKEN);
  });

  it("takes the email from the key when TASKER_JIRA_EMAIL is blank", () => {
    const env = { TASKER_JIRA_TOKEN: FAKE_TOKEN, TASKER_JIRA_EMAIL: "  " };

    expect(jiraCredentials({ email: "key@example.com" }, env, "acli@example.com").email).toBe("key@example.com");
  });

  it("takes the email from the key when TASKER_JIRA_EMAIL is empty", () => {
    const env = { TASKER_JIRA_TOKEN: FAKE_TOKEN, TASKER_JIRA_EMAIL: "" };

    expect(jiraCredentials({ email: "key@example.com" }, env, "acli@example.com").email).toBe("key@example.com");
  });

  it("takes the email of acli last", () => {
    const env = { TASKER_JIRA_TOKEN: FAKE_TOKEN };

    expect(jiraCredentials({}, env, "acli@example.com").email).toBe("acli@example.com");
  });

  it("throws JiraCredentialError when no source gives an email", () => {
    const error = thrownBy(() => jiraCredentials({}, { TASKER_JIRA_TOKEN: FAKE_TOKEN }, undefined));

    expect(error).toBeInstanceOf(JiraCredentialError);
    expect((error as Error).message).toBe("no Jira email: set TASKER_JIRA_EMAIL or issueTracker.email");
    expect((error as JiraCredentialError).missing).toBe("email");
  });
});

describe("jiraGet", () => {
  it("calls the URL with basic auth and passes the signal", async () => {
    const fake = fakeFetch([{ url: URL_MYSELF, status: 200, body: {} }]);
    const signal = new AbortController().signal;

    await jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: fake.fetch, what: "the token check", signal });

    expect(fake.calls()).toEqual([{ url: URL_MYSELF, authorization: FAKE_BASIC_AUTH, signal }]);
  });

  it("gives the parsed body of a 200", async () => {
    const fake = fakeFetch([{ url: URL_MYSELF, status: 200, body: { accountId: "a" } }]);

    const body = await jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: fake.fetch, what: "the token check" });

    expect(body).toEqual({ accountId: "a" });
  });

  it("rejects a 401 with JiraRestError that holds no credential", async () => {
    const fake = fakeFetch([{ url: URL_MYSELF, status: 401, body: { message: `${FAKE_TOKEN} ${FAKE_EMAIL}` } }]);

    const error = await failureOf(
      jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: fake.fetch, what: "the token check" }),
      JiraRestError,
    );

    expect(error.status).toBe(401);
    expect(error.message).toBe("the Jira REST call for the token check on example.atlassian.net failed with HTTP 401");
    expectNoFakeSecret(error.message);
  });

  it("rejects with JiraRestError and no status when the fetch rejects", async () => {
    const fake = fakeFetch([]);

    const error = await failureOf(
      jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: fake.fetch, what: "the token check" }),
      JiraRestError,
    );

    expect(error.status).toBeUndefined();
    expect(error.message).toBe("the Jira REST call for the token check on example.atlassian.net got no answer");
  });

  it("passes an AbortError through as it is", async () => {
    const abort = new DOMException("aborted", "AbortError");
    const rejecting = (() => Promise.reject(abort)) as typeof fetch;

    const error = await failureOf(
      jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: rejecting, what: "the token check" }),
      DOMException,
    );

    expect(error).toBe(abort);
  });

  it("passes the error of fetch as it is after the signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const timeout = new DOMException("timed out", "TimeoutError");
    const rejecting = (() => Promise.reject(timeout)) as typeof fetch;

    const error = await failureOf(
      jiraGet(SITE, "/rest/api/3/myself", credentials, {
        fetch: rejecting,
        what: "the token check",
        signal: controller.signal,
      }),
      DOMException,
    );

    expect(error).toBe(timeout);
  });

  it("rejects with JiraRestError when the body is not JSON", async () => {
    const fake = fakeFetch([{ url: URL_MYSELF, status: 200 }]);

    const error = await failureOf(
      jiraGet(SITE, "/rest/api/3/myself", credentials, { fetch: fake.fetch, what: "the token check" }),
      JiraRestError,
    );

    expect(error.message).toBe("the Jira REST call for the token check on example.atlassian.net gave bad output");
  });
});
