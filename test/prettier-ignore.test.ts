import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getFileInfo } from "prettier";
import { describe, expect, it } from "vitest";
import { repoRoot } from "./helpers/processes.js";

const root = fileURLToPath(repoRoot);

async function isIgnored(path: string): Promise<boolean> {
  const info = await getFileInfo(join(root, path), { ignorePath: join(root, ".prettierignore") });
  return info.ignored;
}

describe(".prettierignore", () => {
  it("ignores a prompt template", async () => {
    expect(await isIgnored("prompt-templates/some-family/some-name.md")).toBe(true);
  });

  it("does not ignore a doc page", async () => {
    expect(await isIgnored("docs/dev/some-page.md")).toBe(false);
  });
});
