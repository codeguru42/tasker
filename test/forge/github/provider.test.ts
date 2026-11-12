import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitHubForge } from "../../../src/forge/github/provider.js";
import { createGhSession } from "../../../src/github/forge-session.js";
import { ciStatus } from "../../../src/forge/github/ci.js";
import { createPr, isPrMerged, listOpenPrs, mergePr } from "../../../src/forge/github/pr.js";
import type { ForgeProvider } from "../../../src/forge/provider.js";
import { diagnosticStrings, failureOf } from "../../helpers/errors.js";
import { forgeGh } from "../../helpers/forge-gh.js";
import { useProcessEnv, useTempDir } from "../../helpers/temp.js";

const token = "provider-token-secret";
const account = "forge-account";
const sha = "0123456789abcdef0123456789abcdef01234567";
const prNumber = 42;
const prUrl = "https://github.com/acme/project/pull/42";
const openRows = [{ number: prNumber, url: prUrl, baseRefName: "main", isCrossRepository: false }];
const openArgs = [
  "pr",
  "list",
  "--head",
  "feature",
  "--state",
  "open",
  "--json",
  "number,url,baseRefName,isCrossRepository",
  "--limit",
  "100",
];
const createArgs = ["pr", "create", "--head", "feature", "--base", "main", "--title", "Title", "--body", "Body"];

function makeProvider(id = account): ForgeProvider {
  return createGitHubForge(id);
}

function fixture(answers: Parameters<typeof forgeGh>[2] = [], envNames: string[] = []) {
  const dir = useTempDir("tasker-github-forge-provider-");
  const worktree = join(dir, "worktree");
  mkdirSync(worktree);
  const fake = forgeGh(
    dir,
    token,
    [{ args: ["auth", "token", "--user", account], stdout: `${token}\n` }, ...answers],
    envNames,
  );
  const env = {
    ...fake.env,
    TASKER_PATH: fake.env.PATH,
    TASKER_HOME: "/tasker/home",
    TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
  };
  return { dir, fake, env, worktree };
}

describe("createGitHubForge", () => {
  it("passes the supplied HOME and the tasker GitHub config directory to gh", async () => {
    const { fake, worktree } = fixture(
      [{ args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"OPEN"}' }],
      ["GH_CONFIG_DIR", "HOME"],
    );

    await makeProvider().isPrMerged(prNumber, worktree, {
      ...fake.env,
      TASKER_PATH: fake.env.PATH,
      TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
      HOME: "/tasker/home",
    });

    expect(fake.calls()[1]?.env).toEqual({ GH_CONFIG_DIR: "/tasker/gh-config", HOME: "/tasker/home" });
  });

  it("creates the exact provider interface without starting gh", async () => {
    const { fake } = fixture();
    useProcessEnv(fake.env);
    const provider = makeProvider();

    expect(provider.id).toBe("github");
    expect(provider.account).toBe(account);
    expect(Object.keys(provider).sort()).toEqual(
      ["account", "ciStatus", "createPr", "id", "isPrMerged", "listOpenPrs", "mergePr"].sort(),
    );
    expect(fake.calls()).toEqual([]);
  });

  it("passes all operation arguments and worktree paths, with no repo override", async () => {
    const { fake, env, worktree } = fixture([
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
        stdout: '[{"check_runs":[]}]',
      },
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
        stdout: '[{"statuses":[]}]',
      },
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
        stdout: '[{"workflow_runs":[]}]',
      },
      { args: openArgs, stdout: JSON.stringify(openRows) },
      { args: createArgs, stdout: `https://github.com/acme/project/pull/42` },
      { args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"OPEN"}' },
      { args: ["pr", "merge", "42", "--squash", "--match-head-commit", sha], stdout: "accepted" },
    ]);
    const provider = makeProvider();
    await provider.ciStatus(sha, worktree, env);
    await provider.listOpenPrs({ cwd: worktree, head: "feature" }, env);
    await provider.createPr({ cwd: worktree, head: "feature", base: "main", title: "Title", body: "Body" }, env);
    await provider.isPrMerged(prNumber, worktree, env);
    await provider.mergePr(prNumber, "squash", sha, worktree, env);

    const calls = fake.calls().map(({ args, cwd }) => ({ args, cwd }));
    expect(calls).toHaveLength(8);
    expect(calls[0]).toEqual({ args: ["auth", "token", "--user", account], cwd: process.cwd() });
    expect(calls.slice(1, 4)).toEqual(
      expect.arrayContaining([
        {
          args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
          cwd: worktree,
        },
        {
          args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
          cwd: worktree,
        },
        {
          args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
          cwd: worktree,
        },
      ]),
    );
    expect(calls.slice(4)).toEqual([
      { args: openArgs, cwd: worktree },
      { args: createArgs, cwd: worktree },
      { args: ["pr", "view", "42", "--json", "state"], cwd: worktree },
      { args: ["pr", "merge", "42", "--squash", "--match-head-commit", sha], cwd: worktree },
    ]);
    expect(fake.calls().flatMap(({ args }) => args)).not.toContain("--repo");
    expect(
      fake
        .calls()
        .filter(({ args }) => args[0] !== "auth")
        .every(({ tokenMatches }) => tokenMatches),
    ).toBe(true);
  });

  it("reuses one successful account lookup and starts a fresh lookup for each provider", async () => {
    const { fake, env, worktree } = fixture([
      { args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"OPEN"}' },
      { args: openArgs, stdout: "[]" },
    ]);
    const first = makeProvider();
    await first.isPrMerged(prNumber, worktree, env);
    await first.listOpenPrs({ cwd: worktree, head: "feature" }, env);
    const second = makeProvider();
    await second.isPrMerged(prNumber, worktree, env);

    expect(fake.calls().filter(({ args }) => args[0] === "auth")).toHaveLength(2);
  });

  it("retries an empty token lookup with the next call environment", async () => {
    const firstDir = useTempDir("tasker-github-forge-provider-empty-token-");
    const secondDir = useTempDir("tasker-github-forge-provider-retry-token-");
    const worktree = join(useTempDir("tasker-github-forge-provider-retry-worktree-"), "worktree");
    mkdirSync(worktree);
    const firstFake = forgeGh(firstDir, token, [{ args: ["auth", "token", "--user", account], stdout: "" }]);
    const secondFake = forgeGh(secondDir, token, [
      { args: ["auth", "token", "--user", account], stdout: `${token}\n` },
      { args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"MERGED"}' },
    ]);
    const firstEnv: NodeJS.ProcessEnv = {
      ...firstFake.env,
      TASKER_PATH: firstFake.env.PATH,
      TASKER_HOME: "/tasker/home",
      TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
    };
    const secondEnv: NodeJS.ProcessEnv = {
      ...secondFake.env,
      TASKER_PATH: secondFake.env.PATH,
      TASKER_HOME: "/tasker/home",
      TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
    };
    const firstEnvBefore = { ...firstEnv };
    const secondEnvBefore = { ...secondEnv };
    const processEnvBefore = { ...process.env };
    const provider = makeProvider();

    await failureOf(provider.isPrMerged(prNumber, worktree, firstEnv), Error);
    expect(firstFake.calls()).toEqual([
      { args: ["auth", "token", "--user", account], cwd: process.cwd(), tokenMatches: false, env: {} },
    ]);
    await expect(provider.isPrMerged(prNumber, worktree, secondEnv)).resolves.toBe(true);

    expect(secondFake.calls()).toEqual([
      { args: ["auth", "token", "--user", account], cwd: process.cwd(), tokenMatches: false, env: {} },
      {
        args: ["pr", "view", "42", "--json", "state"],
        cwd: worktree,
        tokenMatches: true,
        env: {},
      },
    ]);
    for (const dir of [firstDir, secondDir]) {
      expect(readFileSync(join(dir, "bin", "gh"), "utf8")).not.toContain(token);
      expect(readFileSync(join(dir, "forge-gh.log"), "utf8")).not.toContain(token);
    }
    expect(firstEnv).toEqual(firstEnvBefore);
    expect(secondEnv).toEqual(secondEnvBefore);
    expect(process.env).toEqual(processEnvBefore);
  });

  it("keeps caller and process environments unchanged while isolating child values", async () => {
    const { fake, env, worktree } = fixture(
      [{ args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"OPEN"}' }],
      ["HOME", "GH_CONFIG_DIR", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "NO_COLOR"],
    );
    useProcessEnv({
      PATH: "/ambient/path",
      HOME: "/ambient/home",
      GH_TOKEN: "ambient-token",
      GH_HOST: "ambient-host",
      GH_REPO: "ambient/repo",
    });
    const ambientBefore = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GH_TOKEN: process.env.GH_TOKEN,
      GH_HOST: process.env.GH_HOST,
      GH_REPO: process.env.GH_REPO,
    };
    Object.assign(env, { GH_TOKEN: "caller-token", GH_HOST: "caller-host", GH_REPO: "caller/repo" });
    const envBefore = { ...env };

    await makeProvider().isPrMerged(prNumber, worktree, env);

    expect(env).toEqual(envBefore);
    expect({
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      GH_TOKEN: process.env.GH_TOKEN,
      GH_HOST: process.env.GH_HOST,
      GH_REPO: process.env.GH_REPO,
    }).toEqual(ambientBefore);
    expect(fake.calls().at(-1)).toMatchObject({
      cwd: worktree,
      tokenMatches: true,
      env: {
        HOME: "/tasker/home",
        GH_CONFIG_DIR: "/tasker/gh-config",
        GH_PROMPT_DISABLED: "1",
        GH_NO_UPDATE_NOTIFIER: "1",
        NO_COLOR: "1",
      },
    });
  });

  it("returns the operation results and does not read merge state until asked", async () => {
    const { fake, env, worktree } = fixture([
      { args: openArgs, stdout: JSON.stringify(openRows) },
      { args: createArgs, stdout: `Created pull request ${prUrl}` },
      { args: ["pr", "merge", "42", "--merge", "--match-head-commit", sha], stdout: "" },
      { args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"OPEN"}' },
    ]);
    const provider = makeProvider();
    expect(await provider.listOpenPrs({ cwd: worktree, head: "feature" }, env)).toEqual([
      { number: 42, url: prUrl, base: "main" },
    ]);
    expect(
      await provider.createPr({ cwd: worktree, head: "feature", base: "main", title: "Title", body: "Body" }, env),
    ).toEqual({ number: 42, url: prUrl });
    expect(fake.calls().some(({ args }) => args.includes("state"))).toBe(false);
    await provider.mergePr(prNumber, "merge", sha, worktree, env);
    expect(fake.calls().filter(({ args }) => args.includes("state"))).toHaveLength(0);
    expect(await provider.isPrMerged(prNumber, worktree, env)).toBe(false);
    fake.setMergeState("MERGED");
    expect(await provider.isPrMerged(prNumber, worktree, env)).toBe(true);
    expect(fake.calls().filter(({ args }) => args.includes("state"))).toHaveLength(2);
  });

  it("rejects a guarded merge after the remote head changes", async () => {
    const { fake, env, worktree } = fixture([]);
    fake.setRemoteHead("changed-head");
    const error = await failureOf(makeProvider().mergePr(prNumber, "squash", sha, worktree, env), Error);
    expect(diagnosticStrings(error).join("\n")).toContain("match-head-commit");
  });

  it("keeps token text out of fixture files, logs, output, and errors", async () => {
    const dir = useTempDir("tasker-github-forge-token-safe-");
    const fake = forgeGh(dir, token, [
      { args: ["auth", "token", "--user", account], stdout: `${token}\n` },
      { args: ["pr", "view", "42", "--json", "state"], stdout: token, stderr: `failure ${token}`, exitCode: 1 },
    ]);
    const worktree = join(dir, "worktree");
    mkdirSync(worktree);
    const error = await failureOf(
      makeProvider().isPrMerged(prNumber, worktree, {
        ...fake.env,
        TASKER_PATH: fake.env.PATH,
        TASKER_HOME: "/tasker/home",
      }),
      Error,
    );
    const saved = readFileSync(join(dir, "bin", "gh"), "utf8");
    expect(saved).not.toContain(token);
    expect(JSON.stringify(fake.calls())).not.toContain(token);
    expect(diagnosticStrings(error).join("\n")).not.toContain(token);
    expect(error.message).toContain("***");
    expect(fake.calls().some(({ args }) => args.includes("state"))).toBe(true);
  });

  it("matches each provider result with the direct GitHub operation result", async () => {
    const { fake, env, worktree } = fixture([
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
        stdout: '[{"check_runs":[]}]',
      },
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
        stdout: '[{"statuses":[]}]',
      },
      {
        args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
        stdout: '[{"workflow_runs":[]}]',
      },
      { args: openArgs, stdout: JSON.stringify(openRows) },
      { args: createArgs, stdout: prUrl },
      { args: ["pr", "view", "42", "--json", "state"], stdout: '{"state":"MERGED"}' },
      { args: ["pr", "merge", "42", "--rebase", "--match-head-commit", sha], stdout: "accepted" },
    ]);
    const session = createGhSession(account);
    const provider = makeProvider();
    const directCi = await ciStatus(session, sha, worktree, env);
    expect(await provider.ciStatus(sha, worktree, env)).toBe(directCi);
    const directList = await listOpenPrs(session, { cwd: worktree, head: "feature" }, env);
    expect(await provider.listOpenPrs({ cwd: worktree, head: "feature" }, env)).toEqual(directList);
    const input = { cwd: worktree, head: "feature", base: "main", title: "Title", body: "Body" };
    const directCreate = await createPr(session, input, env);
    expect(await provider.createPr(input, env)).toEqual(directCreate);
    const directMerged = await isPrMerged(session, prNumber, worktree, env);
    expect(await provider.isPrMerged(prNumber, worktree, env)).toBe(directMerged);
    await mergePr(session, prNumber, "rebase", sha, worktree, env);
    await expect(provider.mergePr(prNumber, "rebase", sha, worktree, env)).resolves.toBeUndefined();
    expect(fake.calls().filter(({ args }) => args[0] === "pr" && args[1] === "create")).toHaveLength(2);
    expect(fake.calls().filter(({ args }) => args[0] === "pr" && args[1] === "merge")).toHaveLength(2);
  });
});
