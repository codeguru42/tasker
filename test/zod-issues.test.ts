import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatIssues } from "../src/zod-issues.js";

function issuesOf(schema: z.ZodType, value: unknown): z.core.$ZodIssue[] {
  const result = schema.safeParse(value);
  if (result.success) throw new Error("expected the parse to fail");
  return result.error.issues;
}

describe("formatIssues", () => {
  it("gives an issue with an empty path the given root label", () => {
    const issues = issuesOf(z.string(), 5);
    expect(formatIssues(issues, "(root)")).toEqual([
      "(root): Invalid input: expected string, received number",
    ]);
  });

  it("gives one line for each key of an unrecognized_keys issue", () => {
    const issues = issuesOf(z.strictObject({ a: z.strictObject({}) }), { a: { x: 1, y: 2 } });
    expect(formatIssues(issues, "(root)")).toEqual([
      "a.x: unrecognized key",
      "a.y: unrecognized key",
    ]);
  });
});
