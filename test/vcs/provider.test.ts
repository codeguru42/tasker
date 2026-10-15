import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { runGit } from "../../src/vcs/git/run.js";
import { parseConfig } from "../../src/config/schema.js";
import { createVcsProvider, vcsForRepo } from "../../src/vcs/provider.js";
import { validConfig } from "../helpers/config.js";
import { makeProviderFixture, type ProviderFixture } from "../helpers/git.js";

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

describe("vcsForRepo", () => {
  it("gives the provider and the context of one repo", () => {
    const config = parseConfig(validConfig(), {}, "/home/test");
    const [key] = Object.keys(config.repos);
    const env = { PATH: "/bin" };

    const { vcs, ctx } = vcsForRepo(config, key, env);

    expect(ctx).toEqual({ dataRoot: config.dataRoot, repoKey: key, env });
    expect(vcs.provision).toBeTypeOf("function");
  });
});
