import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filesThatImport, importsPath, sourceDir } from "../helpers.js";

describe("the issue key boundary", () => {
  it("finds no file in src/issue-key that imports from src/issues", () => {
    expect(filesThatImport("issues").filter((file) => file.startsWith("issue-key/"))).toEqual([]);
  });

  it("finds an import of src/issues/provider.ts", () => {
    const sample = 'import { issueProviderFor } from "../issues/provider.js";';
    expect(importsPath("issue-key/resolve.ts", sample, join(sourceDir, "issues"))).toBe(true);
  });

  it("ignores an import of a file in the same folder", () => {
    const sample = 'import { x } from "./github.js";';
    expect(importsPath("issue-key/resolve.ts", sample, join(sourceDir, "issues"))).toBe(false);
  });

  it("does not match src/issue-key as src/issues", () => {
    const sample = 'import { x } from "../issue-key/ref.js";';
    expect(importsPath("commands/x.ts", sample, join(sourceDir, "issues"))).toBe(false);
  });
});
