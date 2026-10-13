import { describe, expect, it } from "vitest";
import { errorMessage } from "../src/error-message.js";

describe("errorMessage", () => {
  it("gives the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("gives the message of a subclass of Error", () => {
    expect(errorMessage(new TypeError("bad type"))).toBe("bad type");
  });

  it("gives a string as it is", () => {
    expect(errorMessage("plain")).toBe("plain");
  });

  it("gives String(value) for a value that is not an Error", () => {
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("does not give the message field of an object that is not an Error", () => {
    expect(errorMessage({ message: "not an Error" })).toBe("[object Object]");
  });
});
