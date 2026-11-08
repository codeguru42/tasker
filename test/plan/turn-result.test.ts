import { describe, expect, it } from "vitest";
import { checkTurnResult, readTurnResult, turnResultJsonSchema } from "../../src/plan/turn-result.js";

function read(output: unknown) {
  return readTurnResult(output);
}

describe("readTurnResult", () => {
  it("reads done", () => {
    expect(read({ result: "done", reason: null })).toEqual({ kind: "done" });
  });

  it("ignores a reason that comes with done", () => {
    expect(read({ result: "done", reason: "All good." })).toEqual({ kind: "done" });
  });

  it("reads blocked with its reason", () => {
    expect(read({ result: "blocked", reason: "No disk." })).toEqual({ kind: "blocked", reason: "No disk." });
  });

  it("gives a fixed reason for blocked with a null reason", () => {
    expect(read({ result: "blocked", reason: null })).toEqual({ kind: "blocked", reason: "(no reason given)" });
  });

  it("gives a fixed reason for blocked with a blank reason", () => {
    expect(read({ result: "blocked", reason: "  " })).toEqual({ kind: "blocked", reason: "(no reason given)" });
  });

  it("reads an extra key as no result, never as done", () => {
    expect(read({ result: "done", reason: null, extra: 1 })).toEqual({
      kind: "none",
      detail: "extra: unrecognized key",
    });
  });

  it("reads a wrong result value as no result", () => {
    const turn = read({ result: "finished" });

    expect(turn.kind).toBe("none");
    expect(turn).toMatchObject({ detail: expect.stringMatching(/^result: /) });
  });

  it("reads a missing reason as no result, never as done", () => {
    expect(read({ result: "done" })).toEqual({
      kind: "none",
      detail: "reason: Invalid input: expected string, received undefined",
    });
  });

  it.each([undefined, null])("reads %s as no result", (output) => {
    expect(read(output)).toEqual({ kind: "none", detail: "returned no result" });
  });

  it("does not throw for other values", () => {
    expect(read("done").kind).toBe("none");
  });
});

describe("turnResultJsonSchema", () => {
  it("has no $schema, refuses extra keys and requires result and reason", () => {
    const schema = turnResultJsonSchema();

    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ additionalProperties: false, required: ["result", "reason"] });
  });
});

describe("checkTurnResult", () => {
  it.each([
    [{ result: "done", reason: null }, { ok: true }],
    [{ result: "blocked", reason: "No disk." }, { ok: true }],
  ])("accepts a usable result", (output, expected) => {
    expect(checkTurnResult(output)).toEqual(expected);
  });

  it.each([undefined, null])("rejects %s with the missing-result problem", (output) => {
    expect(checkTurnResult(output)).toEqual({
      ok: false,
      problems: ["(root): the assistant returned no result"],
    });
  });

  it("reports the schema issues for an empty object", () => {
    expect(checkTurnResult({})).toEqual({
      ok: false,
      problems: [
        'result: Invalid option: expected one of "done"|"blocked"',
        "reason: Invalid input: expected string, received undefined",
      ],
    });
  });

  it("reports an unknown key", () => {
    expect(checkTurnResult({ result: "done", reason: null, extra: true })).toEqual({
      ok: false,
      problems: ["extra: unrecognized key"],
    });
  });
});
