import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packagePath } from "../src/package-path.js";

describe("packagePath", () => {
  it("gives the path of a file at the package root", () => {
    expect(packagePath("package.json")).toBe(fileURLToPath(new URL("../package.json", import.meta.url)));
  });

  it("gives the path of the skills folder", () => {
    expect(packagePath("skills")).toBe(fileURLToPath(new URL("../skills", import.meta.url)));
    expect(existsSync(join(packagePath("skills"), "tasker", "SKILL.md"))).toBe(true);
  });
});
