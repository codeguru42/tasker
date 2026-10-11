import { describe, expect, it } from "vitest";
import { pathSlug } from "../../src/issue-key/path-slug.js";

describe("pathSlug", () => {
  it("replaces / and # with -", () => {
    expect(pathSlug("a/b#c")).toBe("a-b-c");
  });

  it("replaces a run of spaces with one -", () => {
    expect(pathSlug("a  b")).toBe("a-b");
  });

  it("collapses repeated -", () => {
    expect(pathSlug("a--b")).toBe("a-b");
    expect(pathSlug("a/-/b")).toBe("a-b");
  });

  it("strips leading and trailing - and .", () => {
    expect(pathSlug("-.a.-")).toBe("a");
    expect(pathSlug("..x/")).toBe("x");
  });

  it("keeps the case", () => {
    expect(pathSlug("AbC/d")).toBe("AbC-d");
  });

  it("keeps a safe value as it is", () => {
    expect(pathSlug("PROJ-7")).toBe("PROJ-7");
    expect(pathSlug("example.atlassian.net/browse/PROJ-7")).toBe(
      "example.atlassian.net-browse-PROJ-7",
    );
  });
});
