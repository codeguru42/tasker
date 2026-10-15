import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/schema.js";
import { GitError } from "../../src/vcs/git/run.js";
import { configIssuesOf, failureOf, thrownBy } from "./errors.js";

describe("failureOf", () => {
  it("gives the error of a rejected promise", async () => {
    const error = new GitError("m", "x", "", "", 1);
    expect(await failureOf(Promise.reject(error), GitError)).toBe(error);
  });

  it("rejects when the promise resolves", async () => {
    await expect(failureOf(Promise.resolve(1), Error)).rejects.toThrow("resolved");
  });

  it("rejects when the error has another type", async () => {
    await expect(failureOf(Promise.reject(new Error("m")), GitError)).rejects.toThrow("not a");
  });
});

describe("thrownBy", () => {
  it("gives the error that fn throws", () => {
    const error = new Error("m");
    expect(
      thrownBy(() => {
        throw error;
      }),
    ).toBe(error);
  });

  it("throws when fn returns", () => {
    expect(() => thrownBy(() => 1)).toThrow("the function returned, but the test needs a throw");
  });

  it("names what the test needs in the message when fn returns", () => {
    expect(() => thrownBy(() => 1, "a ConfigError")).toThrow(
      "the function returned, but the test needs a ConfigError",
    );
  });
});

describe("configIssuesOf", () => {
  it("gives the issues of a ConfigError", () => {
    expect(
      configIssuesOf(() => {
        throw new ConfigError(["a: b"]);
      }),
    ).toEqual(["a: b"]);
  });

  it("throws when the function returns", () => {
    expect(() => configIssuesOf(() => 1)).toThrow("returned");
  });

  it("throws when the error is not a ConfigError", () => {
    expect(() =>
      configIssuesOf(() => {
        throw new Error("m");
      }),
    ).toThrow("not a ConfigError");
  });
});
