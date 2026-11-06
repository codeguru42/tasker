import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGhSession } from "../../../src/github/forge-session.js";
import { ciStatus } from "../../../src/forge/github/ci.js";
import { failureOf } from "../../helpers/errors.js";
import { forgeGh } from "../../helpers/forge-gh.js";
import type { FakeAnswer } from "../../helpers/fake-commands.js";
import { useTempDir } from "../../helpers/temp.js";

const sha = "0123456789abcdef0123456789abcdef01234567";
const token = "forge-token-secret";
const taskerEnv = (fakeEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  TASKER_PATH: fakeEnv.PATH,
  TASKER_HOME: "/tasker/home",
  TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
  ...fakeEnv,
});
const callCiStatus = (
  session: ReturnType<typeof createGhSession>,
  commit: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
) => {
  return ciStatus(session, commit, cwd, env);
};

function answers(
  results: { checks?: string; statuses?: string; workflows?: string } = {},
  account = "octo",
): FakeAnswer[] {
  return [
    { args: ["auth", "token", "--user", account], stdout: `${token}\n` },
    {
      args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
      stdout: results.checks ?? '[{"check_runs":[]}]',
    },
    {
      args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
      stdout: results.statuses ?? '[{"statuses":[]}]',
    },
    {
      args: ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
      stdout: results.workflows ?? '[{"workflow_runs":[]}]',
    },
  ];
}

describe("ciStatus", () => {
  it("reads all paginated sources from the supplied worktree and leaves empty results pending", async () => {
    const dir = useTempDir("tasker-ci-status-empty-");
    const worktree = join(dir, "worktree");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(worktree);
    const fake = forgeGh(dir, token, answers(), [
      "PATH",
      "HOME",
      "GH_CONFIG_DIR",
      "TASKER_GH_BIN",
      "GH_PROMPT_DISABLED",
      "GH_NO_UPDATE_NOTIFIER",
      "NO_COLOR",
    ]);
    const env = taskerEnv(fake.env);

    await expect(callCiStatus(createGhSession("octo"), sha, worktree, env)).resolves.toBe("pending");

    expect(fake.calls()).toEqual([
      {
        args: ["auth", "token", "--user", "octo"],
        tokenMatches: false,
        cwd: process.cwd(),
        env: {
          PATH: fake.env.PATH,
          HOME: "/tasker/home",
          GH_CONFIG_DIR: "/tasker/gh-config",
          TASKER_GH_BIN: undefined,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
        },
      },
      ...[
        ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
        ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
        ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
      ].map((args) => ({
        args,
        tokenMatches: true,
        cwd: worktree,
        env: {
          PATH: fake.env.PATH,
          HOME: "/tasker/home",
          GH_CONFIG_DIR: "/tasker/gh-config",
          TASKER_GH_BIN: undefined,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
        },
      })),
    ]);
    fake.assertAnswered();
  });

  it("passes when any one source has a passing result", async () => {
    const dir = useTempDir("tasker-ci-status-one-pass-");
    const fake = forgeGh(
      dir,
      token,
      answers({ checks: '[{"check_runs":[{"status":"completed","conclusion":"success"}]}]' }),
    );

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe("passed");
    expect(fake.calls().map((entry) => entry.args)).toEqual([
      ["auth", "token", "--user", "octo"],
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`],
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/commits/${sha}/status?per_page=100`],
      ["api", "--paginate", "--slurp", `repos/{owner}/{repo}/actions/runs?head_sha=${sha}&per_page=100`],
    ]);
    fake.assertAnswered();
  });

  it("uses the configured account and isolated supplied environment", async () => {
    const dir = useTempDir("tasker-ci-status-environment-");
    const account = "configured-account";
    const fake = forgeGh(dir, token, answers({}, account), ["PATH", "HOME", "GH_CONFIG_DIR", "GH_REPO", "GH_HOST"]);
    const ambient = { PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: process.env.GH_TOKEN };
    const supplied = {
      ...taskerEnv(fake.env),
      GH_TOKEN: "caller-token",
      GH_HOST: "caller.example",
      GH_REPO: "caller/repo",
      HOME: "/caller/home",
    };
    const before = { ...supplied };

    await expect(callCiStatus(createGhSession(account), sha, dir, supplied)).resolves.toBe("pending");

    expect(fake.calls()).toHaveLength(4);
    expect(fake.calls()[0]?.args).toEqual(["auth", "token", "--user", account]);
    expect(
      fake
        .calls()
        .slice(1)
        .map((entry) => entry.cwd),
    ).toEqual([dir, dir, dir]);
    expect(
      fake
        .calls()
        .slice(1)
        .map((entry) => entry.env),
    ).toEqual(
      Array.from({ length: 3 }, () => ({
        PATH: fake.env.PATH,
        HOME: "/tasker/home",
        GH_CONFIG_DIR: "/tasker/gh-config",
        GH_REPO: undefined,
        GH_HOST: undefined,
      })),
    );
    expect(supplied).toEqual(before);
    expect({ PATH: process.env.PATH, HOME: process.env.HOME, GH_TOKEN: process.env.GH_TOKEN }).toEqual(ambient);
    fake.assertAnswered();
  });

  it.each([
    ["a running check", { checks: '[{"check_runs":[{"status":"in_progress","conclusion":null}]}]' }, "pending"],
    ["a running workflow", { workflows: '[{"workflow_runs":[{"status":"queued","conclusion":null}]}]' }, "pending"],
    ["a pending commit status", { statuses: '[{"statuses":[{"state":"pending"}]}]' }, "pending"],
    [
      "a neutral completed check",
      { checks: '[{"check_runs":[{"status":"completed","conclusion":"neutral"}]}]' },
      "passed",
    ],
    [
      "a skipped completed workflow",
      { workflows: '[{"workflow_runs":[{"status":"completed","conclusion":"skipped"}]}]' },
      "passed",
    ],
    [
      "a failed completed check",
      { checks: '[{"check_runs":[{"status":"completed","conclusion":"failure"}]}]' },
      "failed",
    ],
    [
      "a cancelled completed workflow",
      { workflows: '[{"workflow_runs":[{"status":"completed","conclusion":"cancelled"}]}]' },
      "failed",
    ],
    ["an error commit status", { statuses: '[{"statuses":[{"state":"error"}]}]' }, "failed"],
  ] as const)("classifies %s", async (_label, result, expected) => {
    const dir = useTempDir("tasker-ci-status-classification-");
    const fake = forgeGh(dir, token, answers(result));

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe(expected);
    fake.assertAnswered();
  });

  it.each([
    [
      "failure before a later pass",
      '[{"check_runs":[{"status":"completed","conclusion":"failure"}]}]',
      '[{"statuses":[{"state":"success"}]}]',
      "failed",
    ],
    [
      "pending before a later pass",
      '[{"check_runs":[{"status":"queued","conclusion":null}]}]',
      '[{"statuses":[{"state":"success"}]}]',
      "pending",
    ],
    [
      "failure from a later page",
      '[{"check_runs":[]},{"check_runs":[{"status":"completed","conclusion":"failure"}]}]',
      '[{"statuses":[{"state":"success"}]}]',
      "failed",
    ],
    [
      "pending from a later page",
      '[{"check_runs":[]},{"check_runs":[{"status":"in_progress","conclusion":null}]}]',
      '[{"statuses":[{"state":"success"}]}]',
      "pending",
    ],
  ] as const)("applies precedence for %s", async (_label, checks, statuses, expected) => {
    const dir = useTempDir("tasker-ci-status-precedence-");
    const fake = forgeGh(dir, token, answers({ checks, statuses }));

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe(expected);
    fake.assertAnswered();
  });

  it("uses individual commit statuses and ignores the combined page state", async () => {
    const dir = useTempDir("tasker-ci-status-page-state-");
    const fake = forgeGh(dir, token, answers({ statuses: '[{"state":"failure","statuses":[{"state":"success"}]}]' }));

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe("passed");
    fake.assertAnswered();
  });

  it("reads more than 100 results from every source and uses results on later pages", async () => {
    const dir = useTempDir("tasker-ci-status-many-results-");
    const checks = JSON.stringify([
      { check_runs: Array.from({ length: 101 }, () => ({ status: "completed", conclusion: "failure" })) },
      { check_runs: [{ status: "completed", conclusion: "success" }] },
    ]);
    const statuses = JSON.stringify([
      { statuses: Array.from({ length: 101 }, () => ({ state: "failure" })) },
      { statuses: [{ state: "success" }] },
    ]);
    const workflows = JSON.stringify([
      { workflow_runs: Array.from({ length: 101 }, () => ({ status: "completed", conclusion: "failure" })) },
      { workflow_runs: [{ status: "completed", conclusion: "success" }] },
    ]);
    const fake = forgeGh(dir, token, answers({ checks, statuses, workflows }));

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe("passed");
    fake.assertAnswered();
  });

  it("accepts extra fields, key order, and whitespace in page responses", async () => {
    const dir = useTempDir("tasker-ci-status-extra-fields-");
    const fake = forgeGh(
      dir,
      token,
      answers({
        checks:
          '[ { "total_count": 1, "extra": true, "check_runs": [ { "conclusion": "success", "status": "completed", "name": "build" } ] } ]',
        statuses: '[ { "statuses": [], "state": "failure", "extra": true } ]',
        workflows: '[ { "workflow_runs": [], "extra": true } ]',
      }),
    );

    await expect(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env))).resolves.toBe("passed");
    fake.assertAnswered();
  });

  it.each([
    ["check run", { checks: '[{"check_runs":[]},{"check_runs":[{"status":"completed","conclusion":7}]}]' }],
    ["workflow run", { workflows: '[{"workflow_runs":[]},{"workflow_runs":[{"status":false,"conclusion":null}]}]' }],
    ["commit status", { statuses: '[{"statuses":[]},{"statuses":[{"state":null}]}]' }],
  ] as const)("rejects a malformed %s on a later page", async (_label, result) => {
    const dir = useTempDir("tasker-ci-status-malformed-entry-");
    const fake = forgeGh(dir, token, answers(result));

    await failureOf(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env)), Error);
    fake.assertAnswered();
  });

  it.each([
    ["check runs", { checks: '[{"check_runs":[]},{"check_runs":null}]' }],
    ["statuses", { statuses: '[{"statuses":[]},{"statuses":false}]' }],
    ["workflow runs", { workflows: '[{"workflow_runs":[]},{"workflow_runs":{}}]' }],
  ] as const)("rejects a malformed %s array on a later page", async (_label, result) => {
    const dir = useTempDir("tasker-ci-status-malformed-array-");
    const fake = forgeGh(dir, token, answers(result));

    await failureOf(callCiStatus(createGhSession("octo"), sha, dir, taskerEnv(fake.env)), Error);
    fake.assertAnswered();
  });
});
