import { mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGh, ghTokenAnswer, makeTempDir } from "../../helpers.js";

type Tracker = import("../../../src/config/schema.js").RepoConfig["issueTracker"];

// A github repo for the doctor checks. The overrides replace fields of its issueTracker.
function githubRepo(key: string, overrides: Partial<Tracker> = {}) {
  const issueTracker = {
    provider: "github",
    account: "octo",
    project: "octo/repo",
    updateOnStart: false,
    updateOnFinish: false,
    ...overrides,
  } as Tracker;
  return { key, issueTracker };
}

describe("gh doctor checks", () => {
  // The module loads again before each test, so that each test starts with an empty token cache.
  // Never import doctor.ts or run.ts at the top of this file: a second copy would have other error classes.
  let doctor: typeof import("../../../src/issues/github/doctor.js");
  let dir: string;

  beforeEach(async () => {
    dir = makeTempDir("tasker-gh-doctor-");
    vi.resetModules();
    doctor = await import("../../../src/issues/github/doctor.js");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("ghVersionCheck", () => {
    const versionArgs = ["--version"];
    const OLDER = (found: string) =>
      `gh ${found} is older than the minimum 2.40.0. Before 2.40.0, gh auth token has no --user flag.`;

    it("has the name, required and timeoutMs of the version check", () => {
      const check = doctor.ghVersionCheck();
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh version",
        required: true,
        timeoutMs: 5000,
      });
    });

    it.each([
      ["gh version 2.40.0", "ok", "gh 2.40.0 (minimum 2.40.0)"],
      ["gh version 2.101.0", "ok", "gh 2.101.0 (minimum 2.40.0)"],
      ["gh version 3.0.0", "ok", "gh 3.0.0 (minimum 2.40.0)"],
      ["gh version 2.40.0-rc.1", "ok", "gh 2.40.0-rc.1 (minimum 2.40.0)"],
      [
        "gh version 2.40.0 (2023-12-07)\r\nhttps://github.com/cli/cli/releases/tag/v2.40.0",
        "ok",
        "gh 2.40.0 (minimum 2.40.0)",
      ],
      ["gh version 2.39.2", "error", OLDER("2.39.2")],
      ["gh version 1.99.99", "error", OLDER("1.99.99")],
      ["gh version 2.39.99-pre", "error", OLDER("2.39.99-pre")],
      ["gh version 2.40", "error", "cannot read the gh version from: gh version 2.40"],
      ["gh version DEV", "error", "cannot read the gh version from: gh version DEV"],
      ["gh version v2.40.0", "error", "cannot read the gh version from: gh version v2.40.0"],
      ["", "error", "cannot read the gh version from: "],
    ])("reads %j as %s", async (stdout, status, detail) => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout }]);
      const result = await doctor.ghVersionCheck().run(fake.env);
      expect(result.status).toBe(status);
      expect(result.detail).toBe(detail);
      expect(result.remediation).toBe(
        status === "error" && detail.includes("older")
          ? "Install gh 2.40.0 or newer."
          : undefined,
      );
      expect(fake.calls()).toEqual([{ args: versionArgs, ghToken: undefined, env: {} }]);
    });

    it("gives error and a remediation when gh is not installed", async () => {
      const empty = `${dir}/empty`;
      mkdirSync(empty);
      expect(await doctor.ghVersionCheck().run({ PATH: empty })).toEqual({
        status: "error",
        detail: "gh is not installed. tasker needs gh 2.40.0 or newer.",
        remediation: "Install gh 2.40.0 or newer.",
      });
    });

    it("gives the timeout result when gh is slow", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "x", delaySeconds: 5 }]);
      const start = Date.now();
      const result = await doctor.ghVersionCheck(200).run(fake.env);
      expect(result).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(fake.calls()).toEqual([{ args: versionArgs, ghToken: undefined, env: {} }]);
    });

    it("makes no token call", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "gh version 2.101.0\n" }]);
      await doctor.ghVersionCheck().run(fake.env);
      expect(fake.calls().filter((call) => call.args[0] === "auth")).toEqual([]);
    });
  });

  describe("ghAuthCheck", () => {
    const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];
    const loginArgs = ["api", "user", "--jq", ".login"];
    const remediation = "Run `gh auth login --hostname github.com` and log in as octo.";
    const argLists = (fake: ReturnType<typeof fakeGh>) => fake.calls().map((call) => call.args);

    it("has the name, required and timeoutMs of the auth check", () => {
      const check = doctor.ghAuthCheck("octo");
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh auth: octo",
        required: true,
        timeoutMs: 15000,
      });
    });

    it("is ok when the token is for the account", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: loginArgs, stdout: "octo\n" },
      ]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "ok",
        detail: "gh is logged in as octo",
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and a remediation for another login", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: loginArgs, stdout: "hubot\n" },
      ]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "error",
        detail: "the token of the account octo is for the login hubot",
        remediation,
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and a remediation when the token call fails", async () => {
      const fake = fakeGh(dir, {}, [
        { args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 },
      ]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "error",
        detail:
          "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
        remediation,
      });
      expect(argLists(fake)).toEqual([tokenArgs]);
    });

    it("gives the timeout result when the token call is slow", async () => {
      const fake = fakeGh(dir, {}, [
        { ...ghTokenAnswer("octo", "gho_test"), delaySeconds: 5 },
        { args: loginArgs, stdout: "octo\n" },
      ]);
      const start = Date.now();
      expect(await doctor.ghAuthCheck("octo", 200).run(fake.env)).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(argLists(fake)).toEqual([tokenArgs]);
    });

    it("gives the timeout result when the api user call is slow", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: loginArgs, stdout: "octo\n", delaySeconds: 5 },
      ]);
      const start = Date.now();
      expect(await doctor.ghAuthCheck("octo", 200).run(fake.env)).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });
  });

  describe("ghProjectCheck", () => {
    const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];
    const viewArgs = (project: string) => ["repo", "view", project, "--json", "nameWithOwner"];
    const remediation = (key: string) =>
      `Make sure that issueTracker.project of ${key} names the repo on GitHub, and that the account octo can see it.`;
    const argLists = (fake: ReturnType<typeof fakeGh>) => fake.calls().map((call) => call.args);

    it("has the name, required and timeoutMs of the project check", () => {
      const check = doctor.ghProjectCheck(githubRepo("octo/repo"));
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh project: octo/repo",
        required: true,
        timeoutMs: 15000,
      });
    });

    it("is ok when the account can see the project", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: viewArgs("octo/repo"), stdout: '{"nameWithOwner":"octo/repo"}\n' },
      ]);
      const check = doctor.ghProjectCheck(githubRepo("main-repo"));
      expect(await check.run(fake.env)).toEqual({
        status: "ok",
        detail: "main-repo: the account octo can see the project octo/repo",
      });
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/repo")]);
    });

    it("uses the repo key as the project when issueTracker.project is not set", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: viewArgs("octo/keyed"), stdout: "{}" },
      ]);
      const check = doctor.ghProjectCheck(githubRepo("octo/keyed", { project: undefined }));
      expect(await check.run(fake.env)).toEqual({
        status: "ok",
        detail: "octo/keyed: the account octo can see the project octo/keyed",
      });
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/keyed")]);
    });

    it("gives error and a remediation when the project cannot be seen", async () => {
      const stderr =
        "GraphQL: Could not resolve to a Repository with the name 'octo/nope'. (repository)\n";
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: viewArgs("octo/nope"), stderr, exitCode: 1 },
      ]);
      const check = doctor.ghProjectCheck(githubRepo("nope", { project: "octo/nope" }));
      expect(await check.run(fake.env)).toEqual({
        status: "error",
        detail:
          "nope: the account octo cannot see the project octo/nope: gh repo view failed with exit code 1: GraphQL: Could not resolve to a Repository with the name 'octo/nope'. (repository)",
        remediation: remediation("nope"),
      });
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/nope")]);
    });

    it("gives the timeout result when gh is slow", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: viewArgs("octo/repo"), stdout: "{}", delaySeconds: 5 },
      ]);
      const start = Date.now();
      const check = doctor.ghProjectCheck(githubRepo("octo/repo"), 200);
      expect(await check.run(fake.env)).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/repo")]);
    });
  });
});
