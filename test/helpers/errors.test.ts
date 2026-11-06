import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config/schema.js";
import { GitError } from "../../src/vcs/git/run.js";
import { configIssuesOf, failureOf, thrownBy } from "./errors.js";
// @ts-expect-error The shared export is added in the next commit.
import { diagnosticStrings } from "./errors.js";

function callDiagnosticStrings(value: unknown): string[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return diagnosticStrings(value);
}

describe("diagnosticStrings", () => {
  it("collects strings from nested own properties", () => {
    expect(callDiagnosticStrings({ outer: "first", nested: { inner: "second" } })).toEqual(["first", "second"]);
  });

  it("stops when objects form a cycle", () => {
    const value: { text: string; next?: unknown } = { text: "kept" };
    value.next = value;

    expect(callDiagnosticStrings(value)).toEqual(["kept"]);
  });

  it("skips a property whose getter throws", () => {
    const value = { safe: "kept" };
    Object.defineProperty(value, "broken", {
      get() {
        throw new Error("getter failed");
      },
    });

    expect(callDiagnosticStrings(value)).toEqual(["kept"]);
  });
});

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
    expect(() => thrownBy(() => 1, "a ConfigError")).toThrow("the function returned, but the test needs a ConfigError");
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
