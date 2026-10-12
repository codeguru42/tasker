import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitProvider } from "../../../src/vcs/git/provider.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { taskBranchName, taskWorktreePath } from "../../../src/vcs/git/worktree.js";
import { localBranches, makeProviderFixture, type ProviderFixture } from "../../helpers.js";

describe("createGitProvider", () => {
  let fixture: ProviderFixture;

  beforeEach(async () => {
    fixture = await makeProviderFixture();
  });

  afterEach(() => {
    fixture.remove();
  });

  const paths = () => repoPaths(fixture.context.dataRoot, fixture.context.repoKey);
  const provider = () => createGitProvider({ remote: fixture.origin.path, config: {} });
  const base = "refs/remotes/origin/main";

  describe("provision and workspaces", () => {
    it("makes the clone of the repo at its folder", async () => {
      await provider().provision(fixture.context);
      expect(existsSync(paths().clone)).toBe(true);
    });

    it("creates, reuses and reuses the task ref of a workspace", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const input = { shortRef: "issue-1", title: "Add the thing", baseRevision: base };
      const first = await git.createWorkspace(fixture.context, input);
      expect(first).toEqual({
        path: taskWorktreePath(paths().worktrees, "issue-1"),
        taskRef: taskBranchName("issue-1", "Add the thing"),
        state: "created",
      });
      const second = await git.createWorkspace(fixture.context, input);
      expect(second.state).toBe("reused-workspace");
      await git.removeWorkspace(fixture.context, { path: first.path });
      const third = await git.createWorkspace(fixture.context, input);
      expect(third.state).toBe("reused-task-ref");
    });

    it("removes the folder of a workspace and keeps its task ref", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const workspace = await git.createWorkspace(fixture.context, {
        shortRef: "issue-1",
        title: "Add the thing",
        baseRevision: base,
      });
      await git.removeWorkspace(fixture.context, { path: workspace.path });
      expect(existsSync(workspace.path)).toBe(false);
      expect(await localBranches(paths().clone, fixture.context.env)).toContain(
        `refs/heads/${workspace.taskRef}`,
      );
    });
  });

  describe("installPushGuard", () => {
    it("writes the hook again with the folder of the publish tokens", async () => {
      const git = provider();
      await git.provision(fixture.context);
      const hook = join(paths().clone, "hooks", "pre-push");
      rmSync(hook);
      git.installPushGuard(fixture.context);
      expect(existsSync(hook)).toBe(true);
      expect(readFileSync(hook, "utf8")).toContain(resolve(paths().publishTokens));
    });
  });
});
