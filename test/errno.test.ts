import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errnoCode, hasErrnoCode } from "../src/errno.js";
import { thrownBy, useTempDir } from "./helpers.js";

describe("errnoCode", () => {
  it("gives ENOENT for the error of a read of a missing path", () => {
    const dir = useTempDir("tasker-errno-");
    const caught = thrownBy(() => readFileSync(join(dir, "missing")));
    expect(caught).toBeInstanceOf(Error);
    expect(errnoCode(caught)).toBe("ENOENT");
  });

  it("gives the string code of an Error", () => {
    expect(errnoCode(Object.assign(new Error("x"), { code: "EPERM" }))).toBe("EPERM");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "ENOENT"],
    ["an Error with no code", new Error("x")],
    ["an object with a code that is not a string", { code: 5 }],
  ])("gives undefined for %s", (_name, value) => {
    expect(errnoCode(value)).toBeUndefined();
  });
});

describe("hasErrnoCode", () => {
  const error = Object.assign(new Error("x"), { code: "ENOENT" });

  it("gives true for a code in the list", () => {
    expect(hasErrnoCode(error, ["EPERM", "ENOENT"])).toBe(true);
  });

  it("gives false for a code that is not in the list", () => {
    expect(hasErrnoCode(error, ["EPERM"])).toBe(false);
  });

  it("gives false for an error with no code, also with an empty list", () => {
    expect(hasErrnoCode(new Error("x"), ["ENOENT"])).toBe(false);
    expect(hasErrnoCode(new Error("x"), [])).toBe(false);
  });

  it("gives false for null", () => {
    expect(hasErrnoCode(null, ["ENOENT"])).toBe(false);
  });
});
