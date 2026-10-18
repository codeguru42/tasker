import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { parseConfig } from "../../src/config/schema.js";
import { createVcsProvider, uncommittedChangeText, vcsDoctorChecks, vcsForRepo } from "../../src/vcs/provider.js";
import { validConfig } from "../helpers/config.js";
import { gitOutput, makeProviderFixture, type ProviderFixture } from "../helpers/git.js";

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
    expect(await gitOutput({ gitDir: clone }, env, "config", "--get", "user.name")).toBe("Provider Test");
    expect(await gitOutput({ gitDir: clone }, env, "config", "--get", "remote.origin.url")).toBe(fixture.origin.path);
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

describe("vcsDoctorChecks", () => {
  const o = { procRoot: "/proc", platform: "linux" } as const;

  it("gives one git version check for two git repos", () => {
    const raw = validConfig();
    const [first] = Object.keys(raw.repos);
    raw.repos.other = { ...raw.repos[first] };
    const config = parseConfig(raw, {}, "/home/test");

    const names = vcsDoctorChecks(config, o).map((check) => check.name);

    expect(names).toEqual([
      "git version",
      `git identity: ${first}`,
      `git connection: ${first}`,
      `git lock files: ${first}`,
      "git identity: other",
      "git connection: other",
      "git lock files: other",
    ]);
  });

  it("gives no doctor checks for a configuration with no repo", () => {
    const config = parseConfig(validConfig(), {}, "/home/test");

    expect(vcsDoctorChecks({ ...config, repos: {} }, o)).toEqual([]);
  });
});

describe("uncommittedChangeText", () => {
  it("keeps the leading space of the status", () => {
    expect(uncommittedChangeText({ status: " M", path: "a" })).toBe(" M a");
  });

  it("keeps a comma of the path", () => {
    expect(uncommittedChangeText({ status: "??", path: "a,b.txt" })).toBe("?? a,b.txt");
  });
});
