import { describe, expect, it } from "vitest";
import { failureOf } from "./errors.js";
import { fakeFetch } from "./fake-fetch.js";

const URL_A = "https://example.atlassian.net/rest/api/3/myself";

describe("fakeFetch", () => {
  it("resolves a known URL with the status and the JSON of the body", async () => {
    const fake = fakeFetch([{ url: URL_A, status: 201, body: { name: "x" } }]);

    const response = await fake.fetch(URL_A);

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ name: "x" });
  });

  it("records the URL, the Authorization header and the signal of each call", async () => {
    const fake = fakeFetch([{ url: URL_A, status: 200, body: {} }]);
    const signal = new AbortController().signal;

    await fake.fetch(URL_A, { headers: { Authorization: "Basic abc" }, signal });
    await fake.fetch(URL_A);

    expect(fake.calls()).toEqual([
      { url: URL_A, authorization: "Basic abc", signal },
      { url: URL_A, authorization: null, signal: undefined },
    ]);
  });

  it("rejects an unknown URL with an error that names it", async () => {
    const fake = fakeFetch([]);

    const error = await failureOf(fake.fetch("https://other.example/x"), Error);

    expect(error.message).toContain("https://other.example/x");
  });
});
