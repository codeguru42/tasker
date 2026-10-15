import { describe, expect, it } from "vitest";
import { readTurnResult, turnResultJsonSchema } from "../../src/plan/turn-result.js";

function read(output: unknown) {
  return readTurnResult(output);
}

describe("readTurnResult", () => {
  it("reads done", () => {
    expect(read({ result: "done" })).toEqual({ kind: "done" });
  });

  it("ignores a reason that comes with done", () => {
    expect(read({ result: "done", reason: "All good." })).toEqual({ kind: "done" });
  });

  it("reads blocked with its reason", () => {
    expect(read({ result: "blocked", reason: "No disk." })).toEqual({ kind: "blocked", reason: "No disk." });
  });

  it("gives a fixed reason for blocked without a reason", () => {
    expect(read({ result: "blocked" })).toEqual({ kind: "blocked", reason: "(no reason given)" });
  });

  it("gives a fixed reason for blocked with a blank reason", () => {
    expect(read({ result: "blocked", reason: "  " })).toEqual({ kind: "blocked", reason: "(no reason given)" });
  });

  it("reads an extra key as no result, never as done", () => {
    expect(read({ result: "done", extra: 1 })).toEqual({ kind: "none", detail: "extra: unrecognized key" });
  });

  it("reads a wrong result value as no result", () => {
    const turn = read({ result: "finished" });

    expect(turn.kind).toBe("none");
    expect(turn).toMatchObject({ detail: expect.stringMatching(/^result: /) });
  });

  it.each([undefined, null])("reads %s as no result", (output) => {
    expect(read(output)).toEqual({ kind: "none", detail: "returned no result" });
  });

  it("does not throw for other values", () => {
    expect(read("done").kind).toBe("none");
  });
});

describe("turnResultJsonSchema", () => {
  it("has no $schema, refuses extra keys and requires result", () => {
    const schema = turnResultJsonSchema();

    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ additionalProperties: false, required: ["result"] });
  });
});
