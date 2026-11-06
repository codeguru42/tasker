import { describe, expect, it, vi } from "vitest";
import type { Config } from "../../src/config/schema.js";
import type { ForgeProvider } from "../../src/forge/provider.js";
import { thrownBy } from "../helpers/errors.js";
import { configWithTrackers } from "../helpers/config.js";
import { forgeGh } from "../helpers/forge-gh.js";
import { useTempDir } from "../helpers/temp.js";

const token = "registry-token-secret";

async function registrySelector(): Promise<(config: Config, repoKey: string) => ForgeProvider> {
  const registry = await vi.importActual<Record<string, unknown>>("../../src/forge/registry.js");
  return registry.forgeForRepo as (config: Config, repoKey: string) => ForgeProvider;
}

function configFor(
  tracker: Record<string, unknown> = { provider: "jira", project: "TEST", site: "one.atlassian.net" },
): Config {
  const config = configWithTrackers({ repo: tracker });
  config.repos.repo.forge = { provider: "github", account: "forge-owner", mergeMethod: "merge" };
  return config;
}

function fake() {
  return forgeGh(useTempDir("tasker-forge-registry-"), token, []);
}

describe("forgeForRepo", () => {
  it("selects the own GitHub provider entry and the separate forge account", async () => {
    const select = await registrySelector();
    const gh = fake();
    const config = configFor();

    const provider = select(config, "repo");

    expect(provider.id).toBe("github");
    expect(provider.account).toBe("forge-owner");
    expect(config.repos.repo.issueTracker.provider).toBe("jira");
    expect(gh.calls()).toEqual([]);
  });

  it("names the repo and missing forge key and starts no process", async () => {
    const select = await registrySelector();
    const gh = fake();
    const config = configFor();
    delete config.repos.repo.forge;

    const error = thrownBy(() => select(config, "repo"));

    expect(String(error)).toContain("repo");
    expect(String(error)).toContain("repos.repo.forge");
    expect(gh.calls()).toEqual([]);
  });

  it.each(["missing", "constructor", "toString", "__proto__"])("rejects unknown repository key %s", async (repoKey) => {
    const select = await registrySelector();
    const gh = fake();

    const error = thrownBy(() => select(configFor(), repoKey));

    expect(String(error)).toContain(repoKey);
    expect(gh.calls()).toEqual([]);
  });

  it("rejects inherited repository entries", async () => {
    const select = await registrySelector();
    const gh = fake();
    const base = configFor();
    const repos = Object.assign(Object.create({ inherited: base.repos.repo }), base.repos);
    const config = { ...base, repos };

    const error = thrownBy(() => select(config, "inherited"));

    expect(String(error)).toContain("inherited");
    expect(gh.calls()).toEqual([]);
  });

  it.each(["unknown", "toString", "constructor"])("rejects unknown forge provider %s", async (provider) => {
    const select = await registrySelector();
    const gh = fake();
    const config = configFor();
    config.repos.repo.forge = { provider, account: "forge-owner" } as Config["repos"][string]["forge"];

    const error = thrownBy(() => select(config, "repo"));

    expect(String(error)).toContain(provider);
    expect(gh.calls()).toEqual([]);
  });

  it("returns a fresh provider for each selection and keeps forge identity separate", async () => {
    const select = await registrySelector();
    const gh = fake();
    const config = configFor({ provider: "github", account: "tracker-owner" });

    const first = select(config, "repo");
    const second = select(config, "repo");

    expect(first).not.toBe(second);
    expect(first.id).toBe("github");
    expect(first.account).toBe("forge-owner");
    expect(config.repos.repo.issueTracker.account).toBe("tracker-owner");
    expect(gh.calls()).toEqual([]);
  });
});
