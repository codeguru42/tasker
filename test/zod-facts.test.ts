import { describe, expect, it } from "vitest";
import { z } from "zod";

const MEASURE_AGAIN =
  'zod changed this fact. Measure the fact again and update the "zod" section of docs/dev/code-conventions.md.';

function parseWithRefine(
  schema: z.ZodType,
  input: unknown,
  params?: { when: () => boolean },
): { refineInputs: unknown[]; issues: z.core.$ZodIssue[] } {
  const refineInputs: unknown[] = [];
  const result = schema
    .superRefine((value) => {
      refineInputs.push(value);
    }, params)
    .safeParse(input);
  return { refineInputs, issues: result.success ? [] : result.error.issues };
}

const Fields = z.strictObject({
  id: z.string().regex(/^[a-z]+$/),
  label: z.string().min(3),
  kind: z.enum(["a", "b"]),
});
const VALID = { id: "ab", label: "abc", kind: "a" };

const WithPreprocess = z.strictObject({
  wrapped: z.preprocess((value, ctx) => {
    ctx.addIssue({ code: "custom", message: "preprocess issue" });
    return value;
  }, z.number()),
  label: z.string().min(3),
});
const PREPROCESS_INPUT = { wrapped: "not a number", label: "ab" };

const UNKNOWN_KEY = { ...VALID, extra: 1 };
const FAILED_PATTERN = { ...VALID, id: "A1" };
const FAILED_MIN = { ...VALID, label: "ab" };
const MISSING_FIELD = { id: "ab", label: "abc" };
const WRONG_TYPE = { ...VALID, label: 5 };
const BAD_ENUM = { ...VALID, kind: "c" };

describe("a default .superRefine()", () => {
  it.each([
    ["an unknown key", UNKNOWN_KEY],
    ["a failed pattern", FAILED_PATTERN],
    ["a failed .min()", FAILED_MIN],
  ])("still runs after %s", (_kind, input) => {
    const { refineInputs, issues } = parseWithRefine(Fields, input);
    expect(issues.length > 0, MEASURE_AGAIN).toBe(true);
    expect(refineInputs, MEASURE_AGAIN).toHaveLength(1);
  });

  it.each([
    ["a missing field", MISSING_FIELD],
    ["a wrong type", WRONG_TYPE],
    ["a bad enum value", BAD_ENUM],
  ])("is skipped after %s", (_kind, input) => {
    const { refineInputs, issues } = parseWithRefine(Fields, input);
    expect(issues.length > 0, MEASURE_AGAIN).toBe(true);
    expect(refineInputs, MEASURE_AGAIN).toEqual([]);
  });
});

describe("a z.preprocess that adds an issue", () => {
  it("skips its inner schema", () => {
    const { issues } = parseWithRefine(WithPreprocess, PREPROCESS_INPUT);
    const atWrapped = issues.filter((issue) => issue.path.length === 1 && issue.path[0] === "wrapped");
    expect(atWrapped, MEASURE_AGAIN).toHaveLength(1);
    expect(atWrapped[0]?.code, MEASURE_AGAIN).toBe("custom");
  });

  it("skips a default .superRefine() of the parent object", () => {
    const { refineInputs } = parseWithRefine(WithPreprocess, PREPROCESS_INPUT);
    expect(refineInputs, MEASURE_AGAIN).toEqual([]);
  });

  it("lets the other fields still get their checks", () => {
    const { issues } = parseWithRefine(WithPreprocess, PREPROCESS_INPUT);
    const atLabel = issues.filter((issue) => issue.path.length === 1 && issue.path[0] === "label");
    expect(atLabel, MEASURE_AGAIN).toHaveLength(1);
    expect(atLabel[0]?.code, MEASURE_AGAIN).toBe("too_small");
  });
});

describe("a .superRefine() with { when: () => true }", () => {
  it.each([
    ["an unknown key", Fields, UNKNOWN_KEY, VALID],
    ["a failed pattern", Fields, FAILED_PATTERN, FAILED_PATTERN],
    ["a failed .min()", Fields, FAILED_MIN, FAILED_MIN],
    ["a missing field", Fields, MISSING_FIELD, MISSING_FIELD],
    ["a wrong type", Fields, WRONG_TYPE, WRONG_TYPE],
    ["a bad enum value", Fields, BAD_ENUM, BAD_ENUM],
    ["a z.preprocess issue", WithPreprocess, PREPROCESS_INPUT, PREPROCESS_INPUT],
  ])("runs and gets the input without its unknown keys after %s", (_kind, schema, input, expected) => {
    const { refineInputs } = parseWithRefine(schema, input, {
      when: () => true,
    });
    expect(refineInputs, MEASURE_AGAIN).toEqual([expected]);
  });
});

describe("a default value", () => {
  it("skips the schema for .default() and goes through it for .prefault()", () => {
    const upper = z.string().transform((value) => value.toUpperCase());
    expect(upper.default("a").parse(undefined), MEASURE_AGAIN).toBe("a");
    expect(upper.prefault("a").parse(undefined), MEASURE_AGAIN).toBe("A");
  });
});

describe("a z.unknown() field of a z.object()", () => {
  it("fails with one issue at its key when plain and the key is missing", () => {
    const result = z.object({ value: z.unknown() }).safeParse({});
    const issues = result.error?.issues;
    expect(result.success, MEASURE_AGAIN).toBe(false);
    expect(issues, MEASURE_AGAIN).toHaveLength(1);
    expect(issues?.[0]?.path, MEASURE_AGAIN).toEqual(["value"]);
    expect(issues?.[0]?.message, MEASURE_AGAIN).toBe("Invalid input: expected nonoptional, received undefined");
  });

  it("succeeds with .optional() when the key is missing", () => {
    const result = z.object({ value: z.unknown().optional() }).safeParse({});
    expect(result.success, MEASURE_AGAIN).toBe(true);
  });
});
