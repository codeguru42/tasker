import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGh, ghTokenAnswer } from "../../helpers/fake-gh.js";
import { useTempDir } from "../../helpers/temp.js";

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
    dir = useTempDir("tasker-gh-doctor-");
    vi.resetModules();
    doctor = await import("../../../src/issues/github/doctor.js");
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
        status === "error" && detail.includes("older") ? "Install gh 2.40.0 or newer." : undefined,
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
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: loginArgs, stdout: "octo\n" }]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "ok",
        detail: "gh is logged in as octo",
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and a remediation for another login", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: loginArgs, stdout: "hubot\n" }]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "error",
        detail: "the token of the account octo is for the login hubot",
        remediation,
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and a remediation when the token call fails", async () => {
      const fake = fakeGh(dir, {}, [{ args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 }]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toEqual({
        status: "error",
        detail:
          "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
        remediation,
      });
      expect(argLists(fake)).toEqual([tokenArgs]);
    });

    it("gives error and no remediation when gh is not installed", async () => {
      const empty = join(dir, "no-gh");
      mkdirSync(empty);
      const fake = fakeGh(dir, {}, []);
      expect(await doctor.ghAuthCheck("octo").run({ PATH: empty })).toStrictEqual({
        status: "error",
        detail: "gh is not installed: gh was not found on PATH",
      });
      expect(argLists(fake)).toEqual([]);
    });

    it("gives error and no remediation for a 502", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: loginArgs, stderr: "gh: Server Error (HTTP 502)\n", exitCode: 1 },
      ]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toStrictEqual({
        status: "error",
        detail: "gh api user failed with exit code 1: gh: Server Error (HTTP 502)",
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and no remediation when a signal stops gh", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: loginArgs, killWith: "TERM" }]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toStrictEqual({
        status: "error",
        detail: "gh api user was stopped by signal SIGTERM",
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
    });

    it("gives error and a remediation for a 401", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: loginArgs, stderr: "gh: Bad credentials (HTTP 401)\n", exitCode: 1 },
      ]);
      expect(await doctor.ghAuthCheck("octo").run(fake.env)).toStrictEqual({
        status: "error",
        detail: "gh api user failed with exit code 1: gh: Bad credentials (HTTP 401)",
        remediation,
      });
      expect(argLists(fake)).toEqual([tokenArgs, loginArgs]);
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
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: viewArgs("octo/keyed"), stdout: "{}" }]);
      const check = doctor.ghProjectCheck(githubRepo("octo/keyed", { project: undefined }));
      expect(await check.run(fake.env)).toEqual({
        status: "ok",
        detail: "octo/keyed: the account octo can see the project octo/keyed",
      });
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/keyed")]);
    });

    it("gives error and a remediation when the project cannot be seen", async () => {
      const stderr = "GraphQL: Could not resolve to a Repository with the name 'octo/nope'. (repository)\n";
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

    it("gives error with no remediation when the token call fails", async () => {
      const fake = fakeGh(dir, {}, [{ args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 }]);
      const check = doctor.ghProjectCheck(githubRepo("octo/repo"));
      expect(await check.run(fake.env)).toStrictEqual({
        status: "error",
        detail:
          "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
      });
      expect(argLists(fake)).toEqual([tokenArgs]);
    });

    it("gives error with no remediation when a signal stops gh repo view", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { args: viewArgs("octo/repo"), killWith: "TERM" },
      ]);
      const check = doctor.ghProjectCheck(githubRepo("octo/repo"));
      expect(await check.run(fake.env)).toStrictEqual({
        status: "error",
        detail: "gh repo view was stopped by signal SIGTERM",
      });
      expect(argLists(fake)).toEqual([tokenArgs, viewArgs("octo/repo")]);
    });

    it("gives error with no remediation when gh is not installed", async () => {
      const empty = `${dir}/empty`;
      mkdirSync(empty);
      const check = doctor.ghProjectCheck(githubRepo("octo/repo"));
      expect(await check.run({ PATH: empty })).toStrictEqual({
        status: "error",
        detail: "gh is not installed: gh was not found on PATH",
      });
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

  describe("ghLabelsCheck", () => {
    const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];
    const labelArgs = (name: string) => ["api", `repos/octo/repo/labels/${name}`];
    const argLists = (fake: ReturnType<typeof fakeGh>) => fake.calls().map((call) => call.args);
    const found = (name: string) => ({ args: labelArgs(name), stdout: `{"name":"${name}"}\n` });
    const notFound = (name: string) => ({
      args: labelArgs(name),
      stdout:
        '{"message":"Not Found","documentation_url":"https://docs.github.com/rest/issues/labels#get-a-label","status":"404"}',
      stderr: "gh: Not Found (HTTP 404)\n",
      exitCode: 1,
    });
    const IN_PROGRESS = "issueTracker.inProgressLabel";
    const DONE = "issueTracker.doneLabel";
    const bothLabels = githubRepo("main", {
      updateOnStart: true,
      inProgressLabel: "wip",
      updateOnFinish: true,
      doneLabel: "done",
    });

    it("has the name, required and timeoutMs of the labels check", () => {
      const check = doctor.ghLabelsCheck(githubRepo("main"));
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh labels: main",
        required: true,
        timeoutMs: 15000,
      });
    });

    it("is ok with no gh call when no label applies", async () => {
      const fake = fakeGh(dir, {}, []);
      const repo = githubRepo("main", {
        updateOnStart: false,
        inProgressLabel: "wip",
        updateOnFinish: false,
        doneLabel: "done",
      });
      expect(await doctor.ghLabelsCheck(repo).run(fake.env)).toEqual({
        status: "ok",
        detail: "main: no label to check",
      });
      expect(fake.calls()).toEqual([]);
    });

    it("gives warn for a missing in-progress label", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), notFound("wip")]);
      const repo = githubRepo("main", { updateOnStart: true, inProgressLabel: "wip" });
      expect(await doctor.ghLabelsCheck(repo).run(fake.env)).toEqual({
        status: "warn",
        detail: `main:\nthe label "wip" of ${IN_PROGRESS} does not exist in octo/repo: the in-progress write of each tasker start fails and only warns`,
        remediation: `Create each missing label in octo/repo on GitHub, or change ${IN_PROGRESS}.`,
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip")]);
    });

    it("gives warn for a missing done label, after it reads the in-progress label", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), found("wip"), notFound("done")]);
      expect(await doctor.ghLabelsCheck(bothLabels).run(fake.env)).toEqual({
        status: "warn",
        detail:
          `main:\nthe label "wip" of ${IN_PROGRESS} exists\n` +
          `the label "done" of ${DONE} does not exist in octo/repo: the done write of each tasker finish fails and only warns`,
        remediation: `Create each missing label in octo/repo on GitHub, or change ${DONE}.`,
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip"), labelArgs("done")]);
    });

    it("gives warn when both labels are missing, and names both keys", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), notFound("wip"), notFound("done")]);
      expect(await doctor.ghLabelsCheck(bothLabels).run(fake.env)).toEqual({
        status: "warn",
        detail:
          `main:\nthe label "wip" of ${IN_PROGRESS} does not exist in octo/repo: the in-progress write of each tasker start fails and only warns\n` +
          `the label "done" of ${DONE} does not exist in octo/repo: the done write of each tasker finish fails and only warns`,
        remediation: `Create each missing label in octo/repo on GitHub, or change ${IN_PROGRESS} and ${DONE}.`,
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip"), labelArgs("done")]);
    });

    it("is ok when both labels exist", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), found("wip"), found("done")]);
      expect(await doctor.ghLabelsCheck(bothLabels).run(fake.env)).toEqual({
        status: "ok",
        detail: `main:\nthe label "wip" of ${IN_PROGRESS} exists\n` + `the label "done" of ${DONE} exists`,
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip"), labelArgs("done")]);
    });

    it("gives error with the gh message for a 401", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        {
          args: labelArgs("wip"),
          stdout: '{"message":"Bad credentials","status":"401"}',
          stderr: "gh: Bad credentials (HTTP 401)\n",
          exitCode: 1,
        },
      ]);
      const repo = githubRepo("main", { updateOnStart: true, inProgressLabel: "wip" });
      expect(await doctor.ghLabelsCheck(repo).run(fake.env)).toEqual({
        status: "error",
        detail: "gh api repos/octo/repo/labels/wip failed with exit code 1: gh: Bad credentials (HTTP 401)",
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip")]);
    });

    it("gives the timeout result when gh is slow", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { ...found("wip"), delaySeconds: 5 }]);
      const repo = githubRepo("main", { updateOnStart: true, inProgressLabel: "wip" });
      const start = Date.now();
      expect(await doctor.ghLabelsCheck(repo, 200).run(fake.env)).toEqual({
        status: "error",
        detail: "the check did not finish in 200 ms",
      });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("wip")]);
    });

    it.each([
      ["in progress", "in%20progress"],
      ["area/x", "area%2Fx"],
      ["{owner}", "%7Bowner%7D"],
      ["a?b#c%", "a%3Fb%23c%25"],
    ])("encodes the label %j as %s in the path", async (name, encoded) => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), found(encoded)]);
      const repo = githubRepo("main", { updateOnStart: true, inProgressLabel: name });
      const result = await doctor.ghLabelsCheck(repo).run(fake.env);
      expect(result.status).toBe("ok");
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs(encoded)]);
    });
  });

  describe("githubDoctorChecks", () => {
    const jiraRepo = () => {
      const { issueTracker } = githubRepo("j/jira");
      return { key: "j/jira", issueTracker: { ...issueTracker, provider: "jira" } as Tracker };
    };
    const summary = (checks: { name: string; required: boolean; timeoutMs: number }[]) =>
      checks.map(({ name, required, timeoutMs }) => ({ name, required, timeoutMs }));

    it("gives no check when no repo uses the github tracker", () => {
      expect(doctor.githubDoctorChecks([])).toEqual([]);
      expect(doctor.githubDoctorChecks([jiraRepo()])).toEqual([]);
    });

    it("gives the version check, one auth check for each account, then two checks for each repo", () => {
      const checks = doctor.githubDoctorChecks([
        githubRepo("a/one"),
        jiraRepo(),
        githubRepo("a/two"),
        githubRepo("b/three", { account: "hubot" }),
      ]);
      expect(summary(checks)).toEqual([
        { name: "gh version", required: true, timeoutMs: 5000 },
        { name: "gh auth: octo", required: true, timeoutMs: 15000 },
        { name: "gh auth: hubot", required: true, timeoutMs: 15000 },
        { name: "gh project: a/one", required: true, timeoutMs: 15000 },
        { name: "gh labels: a/one", required: true, timeoutMs: 15000 },
        { name: "gh project: a/two", required: true, timeoutMs: 15000 },
        { name: "gh labels: a/two", required: true, timeoutMs: 15000 },
        { name: "gh project: b/three", required: true, timeoutMs: 15000 },
        { name: "gh labels: b/three", required: true, timeoutMs: 15000 },
      ]);
    });

    it("makes only read-only gh calls", async () => {
      const labels = { updateOnStart: true, inProgressLabel: "wip", updateOnFinish: true, doneLabel: "done" };
      const repos = [
        githubRepo("a/one", { ...labels, project: "octo/one" }),
        githubRepo("a/two", { ...labels, project: "octo/two" }),
      ];
      const fake = fakeGh(dir, {}, [
        { args: ["--version"], stdout: "gh version 2.101.0 (2026-09-15)\n" },
        ghTokenAnswer("octo", "gho_test"),
        { args: ["api", "user", "--jq", ".login"], stdout: "octo\n" },
        ...["one", "two"].flatMap((name) => [
          { args: ["repo", "view", `octo/${name}`, "--json", "nameWithOwner"], stdout: "{}" },
          { args: ["api", `repos/octo/${name}/labels/wip`], stdout: "{}" },
          { args: ["api", `repos/octo/${name}/labels/done`], stdout: "{}" },
        ]),
      ]);
      for (const check of doctor.githubDoctorChecks(repos)) {
        const result = await check.run(fake.env);
        expect({ name: check.name, status: result.status }).toEqual({
          name: check.name,
          status: "ok",
        });
      }
      expect(fake.unanswered()).toEqual([]);
      const lists = fake.calls().map((call) => call.args);
      const readOnly = [
        ["--version"],
        ["auth", "token", "--hostname", "github.com", "--user", "octo"],
        ["api", "user", "--jq", ".login"],
        ...["one", "two"].flatMap((name) => [
          ["repo", "view", `octo/${name}`, "--json", "nameWithOwner"],
          ["api", `repos/octo/${name}/labels/wip`],
          ["api", `repos/octo/${name}/labels/done`],
        ]),
      ];
      for (const args of lists) {
        expect(readOnly).toContainEqual(args);
      }
      const forbidden = ["-X", "--method", "-f", "-F", "--field", "--raw-field"];
      for (const args of lists) {
        expect(args.filter((arg) => forbidden.includes(arg))).toEqual([]);
        expect(args.slice(0, 2)).not.toEqual(["issue", "edit"]);
        expect(args.slice(0, 2)).not.toEqual(["label", "create"]);
      }
    });
  });
});
