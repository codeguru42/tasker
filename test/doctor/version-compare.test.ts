import { describe, expect, it } from "vitest";
import { isOlderVersion } from "../../src/doctor/version-compare.js";

describe("isOlderVersion", () => {
  it.each([
    ["a lower patch", [2, 39, 9], [2, 40, 0], true],
    ["an equal version", [2, 40, 0], [2, 40, 0], false],
    ["a higher major", [3, 0, 0], [2, 40, 0], false],
    ["a lower major with high other parts", [1, 99, 99], [2, 40, 0], true],
    ["a higher minor of two parts", [2, 48], [2, 47], false],
    ["a lower minor of two parts", [2, 46], [2, 47], true],
  ])("gives the answer for %s", (_name, version, minimum, expected) => {
    expect(isOlderVersion(version, minimum)).toBe(expected);
  });

  it("throws a RangeError for lists of different lengths", () => {
    expect(() => isOlderVersion([2, 40], [2, 40, 0])).toThrow(RangeError);
  });
});
