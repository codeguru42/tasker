import { describe, expect, it } from "vitest";
import { detailSuffix } from "../src/detail-suffix.js";

describe("detailSuffix", () => {
  it("gives an empty text for an empty detail", () => {
    expect(detailSuffix("")).toBe("");
  });

  it("gives a colon and the detail", () => {
    expect(detailSuffix("boom")).toBe(": boom");
  });

  it("does not trim the detail", () => {
    expect(detailSuffix(" boom ")).toBe(":  boom ");
  });
});
