import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSkill(): string {
  return readFileSync(new URL("../skills/tasker/SKILL.md", import.meta.url), "utf8");
}

describe("skills/tasker/SKILL.md", () => {
  it("has the name tasker and a description in its frontmatter", () => {
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(readSkill())?.[1] ?? "";
    expect(frontmatter).toMatch(/^name: tasker$/m);
    expect(frontmatter).toMatch(/^description: \S.*$/m);
  });
});
