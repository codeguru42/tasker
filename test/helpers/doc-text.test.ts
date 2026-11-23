import { describe, expect, it } from "vitest";
import { docPaths, markdownSection, sharedWordRuns } from "./doc-text.js";

describe("markdownSection", () => {
  it("gives the lines up to the next heading", () => {
    const text = "# Title\n\n## One\nline a\nline b\n\n## Two\nline c\n";
    expect(markdownSection(text, "One")).toBe("line a\nline b");
  });

  it("gives the lines up to the end of the text", () => {
    const text = "## One\nline a\n\n## Two\nline c\nline d\n";
    expect(markdownSection(text, "Two")).toBe("line c\nline d");
  });

  it("stops at a heading of any level", () => {
    const text = "## One\nline a\n### Deeper\nline b\n";
    expect(markdownSection(text, "One")).toBe("line a");
  });

  it("gives undefined for a missing heading", () => {
    expect(markdownSection("## One\nline a\n", "Three")).toBeUndefined();
  });

  it("removes the blank lines at the start and at the end", () => {
    const text = "## One\n\n\nline a\n\nline b\n\n\n## Two\n";
    expect(markdownSection(text, "One")).toBe("line a\n\nline b");
  });
});

describe("docPaths", () => {
  it("gives each doc path in order with no duplicates", () => {
    const text = "Read docs/dev/b.md and docs/a.md, then `docs/dev/b.md` again and docs/dev/sub-dir/c_d.md.";
    expect(docPaths(text)).toEqual(["docs/dev/b.md", "docs/a.md", "docs/dev/sub-dir/c_d.md"]);
  });

  it("gives an empty list when no doc path occurs", () => {
    expect(docPaths("no path here, only README.md")).toEqual([]);
  });
});

describe("sharedWordRuns", () => {
  it("gives a run of words that a line break splits in the doc", () => {
    const body = "one two three four five six seven eight nine";
    const doc = "intro one two three\nfour five six\nseven eight outro";
    expect(sharedWordRuns(body, doc)).toEqual(["one two three four five six seven eight"]);
  });

  it("gives each shared run one time, with a custom size", () => {
    const body = "alpha beta gamma delta";
    const doc = "alpha beta gamma\n\nalpha beta gamma";
    expect(sharedWordRuns(body, doc, 3)).toEqual(["alpha beta gamma"]);
  });

  it("gives an empty list when no run is shared", () => {
    const body = "one two three four five six seven eight";
    const doc = "one two three four five six seven nine";
    expect(sharedWordRuns(body, doc)).toEqual([]);
  });
});
