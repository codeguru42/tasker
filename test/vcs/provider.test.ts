import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { runGit } from "../../src/vcs/git/run.js";
import { createVcsProvider } from "../../src/vcs/provider.js";
import { makeProviderFixture, type ProviderFixture } from "../helpers.js";

describe("createVcsProvider", () => {
  let fixture: ProviderFixture;

  beforeEach(async () => {
    fixture = await makeProviderFixture();
  });

  afterEach(() => {
    fixture.remove();
  });

  it("gives the git provider the remote and the vcs config of the repo", async () => {
    const provider = createVcsProvider({
      remote: fixture.origin.path,
      vcs: { provider: "git", config: { authorName: "Provider Test" } },
    });
    await provider.provision(fixture.context);
    const { clone } = repoPaths(fixture.context.dataRoot, fixture.context.repoKey);
    const env = fixture.context.env;
    expect((await runGit(["config", "--get", "user.name"], { gitDir: clone, env })).trim()).toBe(
      "Provider Test",
    );
    expect(
      (await runGit(["config", "--get", "remote.origin.url"], { gitDir: clone, env })).trim(),
    ).toBe(fixture.origin.path);
  });
});
