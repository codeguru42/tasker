import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { absentPlaceholders } from "../../../src/assistant/codex/placeholders.js";
import { useTempDir } from "../../helpers/temp.js";

describe("absentPlaceholders", () => {
  it("lists each name that does not exist", () => {
    const cwd = useTempDir("tasker-codex-placeholders-");

    expect(absentPlaceholders(cwd)).toEqual({ rootFiles: [], rootFolders: [".agents", ".aws", ".codex"] });
  });

  it("leaves out a folder, a file and a link that exist", () => {
    const cwd = useTempDir("tasker-codex-placeholders-");
    mkdirSync(join(cwd, ".agents"));
    writeFileSync(join(cwd, ".aws"), "");
    symlinkSync(join(cwd, "missing"), join(cwd, ".codex"));

    expect(absentPlaceholders(cwd)).toEqual({ rootFiles: [], rootFolders: [] });
  });
});
