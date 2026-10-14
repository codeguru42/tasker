import { describe, expect, it } from "vitest";
import { executeReadDenyPaths } from "../../src/tasks/assistant-run.js";

describe("executeReadDenyPaths", () => {
  // Every path here is fake. None exists on disk, and each still goes in the list.
  const surfaceDenyReadPaths = ["/k/id"];
  const publishTokensPath = "/p";
  const denyPaths = (env: NodeJS.ProcessEnv) =>
    executeReadDenyPaths({ env, surfaceDenyReadPaths, publishTokensPath });

  it("gives the paths in a fixed order", () => {
    expect(denyPaths({ HOME: "/h", XDG_CONFIG_HOME: "/x", TASKER_CONFIG: "/t/config.json" })).toEqual([
      "/k/id",
      "/h/.ssh",
      "/x/gh",
      "/h/.git-credentials",
      "/h/.netrc",
      "/h/.claude/.credentials.json",
      "/p",
      "/t/config.json",
    ]);
  });

  it("takes the gh folder from GH_CONFIG_DIR, then XDG_CONFIG_HOME, then HOME", () => {
    const ghEntry = (env: NodeJS.ProcessEnv) => denyPaths(env)[2];
    expect(ghEntry({ HOME: "/h", XDG_CONFIG_HOME: "/x", GH_CONFIG_DIR: "/g" })).toBe("/g");
    expect(ghEntry({ HOME: "/h", XDG_CONFIG_HOME: "/x" })).toBe("/x/gh");
    expect(ghEntry({ HOME: "/h" })).toBe("/h/.config/gh");
  });

  it("takes the credentials of Claude Code from CLAUDE_CONFIG_DIR", () => {
    const paths = denyPaths({ HOME: "/h", CLAUDE_CONFIG_DIR: "/c" });
    expect(paths).toContain("/c/.credentials.json");
    expect(paths).not.toContain("/h/.claude/.credentials.json");
  });

  it("gives only the surface paths and the publish tokens when the env names no folder", () => {
    expect(denyPaths({})).toEqual(["/k/id", "/p"]);
  });

  it("gives the gh folder and the configuration of XDG_CONFIG_HOME when HOME is unset", () => {
    expect(denyPaths({ XDG_CONFIG_HOME: "/x" })).toEqual(["/k/id", "/x/gh", "/p", "/x/tasker/config.json"]);
  });

  it("counts a blank HOME as unset", () => {
    expect(denyPaths({ HOME: "  " })).toEqual(["/k/id", "/p"]);
  });

  it("gives the default configuration file under HOME", () => {
    expect(denyPaths({ HOME: "/h" }).at(-1)).toBe("/h/.config/tasker/config.json");
  });
});
