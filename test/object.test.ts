import { describe, expect, it } from "vitest";
import { isObject } from "../src/object.js";

describe("isObject", () => {
  it.each([{}, { a: 1 }])("gives true for the object %j", (value) => {
    expect(isObject(value)).toBe(true);
  });

  it.each([null, undefined, [], [1], "text", 7, true])("gives false for %j", (value) => {
    expect(isObject(value)).toBe(false);
  });
});
