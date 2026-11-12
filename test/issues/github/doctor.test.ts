import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkSummaries } from "../../helpers/doctor.js";
import { fakeGh, ghTokenAnswer } from "../../helpers/fake-gh.js";
import { useTempDir } from "../../helpers/temp.js";

type Tracker = import("../../../src/config/schema.js").RepoConfig["issueTracker"];
type GithubDoctorWithBoardCheck = typeof import("../../../src/issues/github/doctor.js") & {
  ghBoardCheck: (
    repo: import("../../../src/issues/provider.js").IssueDoctorRepo,
    timeoutMs?: number,
  ) => import("../../../src/doctor/check.js").Check;
};

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
  let doctor: GithubDoctorWithBoardCheck;
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
      const env = { ...fake.env };
      delete env.TASKER_GH_BIN;
      const result = await doctor.ghVersionCheck().run(env);
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

    it("reports a missing selected gh executable", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "gh version 2.40.0\n" }]);
      const result = await doctor.ghVersionCheck().run({ ...fake.env, TASKER_GH_BIN: "missing-gh" });
      expect(result).toEqual({
        status: "error",
        detail: "missing-gh is not installed: missing-gh was not found on PATH",
        remediation:
          "Set PATH to the directories for child programs. Make sure that TASKER_GH_BIN selects gh 2.40.0 or newer.",
      });
      expect(fake.calls()).toEqual([]);
    });

    it("gives valid repair advice when PATH is missing for the selected gh executable", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "gh version 2.40.0\n" }]);
      const result = await doctor.ghVersionCheck().run({ TASKER_GH_BIN: fake.env.TASKER_GH_BIN });
      expect(result.status).toBe("error");
      expect(result.detail).toContain("PATH");
      expect(result.remediation).toBe(
        "Set PATH to the directories for child programs. Make sure that TASKER_GH_BIN selects gh 2.40.0 or newer.",
      );
      expect(fake.calls()).toEqual([]);
    });

    it("gives valid repair advice when the selected gh version is too old", async () => {
      const fake = fakeGh(dir, {}, [{ args: versionArgs, stdout: "gh version 2.39.2\n" }]);
      const result = await doctor.ghVersionCheck().run(fake.env);
      expect(result).toEqual({
        status: "error",
        detail: OLDER("2.39.2"),
        remediation:
          "Set PATH to the directories for child programs. Make sure that TASKER_GH_BIN selects gh 2.40.0 or newer.",
      });
      expect(fake.calls()).toEqual([{ args: versionArgs, ghToken: undefined, env: {} }]);
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
    const REVIEW = "issueTracker.reviewLabel";
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

    it("warns about a missing review label when start and finish updates are disabled", async () => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), notFound("peer-review")]);
      const repo = githubRepo("main", { updateOnStart: false, updateOnFinish: false, reviewLabel: "peer-review" });
      expect(await doctor.ghLabelsCheck(repo).run(fake.env)).toEqual({
        status: "warn",
        detail: `main:\nthe label "peer-review" of ${REVIEW} does not exist in octo/repo: the review write of each tasker open-pr fails and only warns`,
        remediation: `Create each missing label in octo/repo on GitHub, or change ${REVIEW}.`,
      });
      expect(argLists(fake)).toEqual([tokenArgs, labelArgs("peer-review")]);
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

  describe("ghBoardCheck", () => {
    const tokenArgs = ["auth", "token", "--hostname", "github.com", "--user", "octo"];
    const boardArgs = (number = 3) => [
      "project",
      "field-list",
      String(number),
      "--owner",
      "octo",
      "--format",
      "json",
      "--limit",
      "100",
    ];
    const remediation = (key: string) =>
      `Make sure that issueTracker.board of ${key} names a board that the account octo can read. The token of the account needs the scopes project and read:project. A fine-grained token cannot open a board of a user.`;
    const fieldRemediation = (key: string) =>
      `Change issueTracker.board.field of ${key} to one single-select field of the configured board.`;
    const optionRemediation = (keys: string) => `Add each missing option to the field on GitHub, or change ${keys}.`;
    const board = {
      owner: "octo",
      number: 3,
      field: "Status",
      inProgress: "In progress",
      done: "Done",
      abort: "Aborted",
    };
    const configKey = (name: "inProgress" | "done" | "abort") => `issueTracker.board.${name}`;
    const singleSelect = (name = "Status", options = ["Todo", "In progress", "Done", "Aborted"]) => ({
      id: "PVTSSF_lADOB9",
      name,
      type: "ProjectV2SingleSelectField",
      options: options.map((option, index) => ({ id: `option-${index}`, name: option })),
    });
    const fieldsJson = (...fields: unknown[]) => JSON.stringify({ fields, totalCount: fields.length });
    const fieldsAnswer = (json: string, number = 3) => ({ args: boardArgs(number), stdout: `${json}\n` });
    const argLists = (fake: ReturnType<typeof fakeGh>) => fake.calls().map((call) => call.args);

    it("has the name, required and timeoutMs of the board check", () => {
      const check = doctor.ghBoardCheck(githubRepo("main", { board }));
      expect({ name: check.name, required: check.required, timeoutMs: check.timeoutMs }).toEqual({
        name: "gh board: main",
        required: true,
        timeoutMs: 15000,
      });
    });

    it("reads the configured field and options with the pinned account", async () => {
      const json = fieldsJson(singleSelect());
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), fieldsAnswer(json)]);
      const check = doctor.ghBoardCheck(githubRepo("main", { updateOnStart: true, updateOnFinish: true, board }));
      const result = await check.run(fake.env);
      expect(result.status).toBe("ok");
      expect(result.detail).toContain("main");
      expect(result.detail).toContain("Status");
      expect(result.detail).toContain("In progress");
      expect(result.detail).toContain("Done");
      expect(result.detail).toContain("Aborted");
      expect(fake.calls()).toEqual([
        { args: tokenArgs, ghToken: undefined, env: {} },
        { args: boardArgs(), ghToken: "gho_test", env: {} },
      ]);
      expect(fake.unanswered()).toEqual([]);
    });

    it("matches field and option names without regard to case", async () => {
      const json = fieldsJson(singleSelect("sTaTuS", ["todo", "IN PROGRESS", "done", "ABORTED"]));
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), fieldsAnswer(json)]);
      const repo = githubRepo("main", {
        updateOnStart: true,
        updateOnFinish: true,
        board: { ...board, field: "Status", inProgress: "In progress", done: "Done", abort: undefined },
      });
      expect((await doctor.ghBoardCheck(repo).run(fake.env)).status).toBe("ok");
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it("warns with the board remediation when field-list fails", async () => {
      const stderr = "GraphQL: Could not resolve to a ProjectV2 with the number 999. (project)\n";
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), { args: boardArgs(999), stderr, exitCode: 1 }]);
      const repo = githubRepo("main", { updateOnStart: true, board: { ...board, number: 999 } });
      const result = await doctor.ghBoardCheck(repo).run(fake.env);
      expect(result.status).toBe("warn");
      expect(result.detail).toContain("main");
      expect(result.remediation).toBe(remediation("main"));
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs(999)]);
    });

    it.each([
      ["no matching field", fieldsJson(singleSelect("Other"))],
      ["multiple case-insensitive fields", fieldsJson(singleSelect("Status"), singleSelect("status"))],
      ["a field of another type", fieldsJson({ id: "PVTF_lADOB9", name: "Status", type: "ProjectV2Field" })],
    ])("warns and gives field advice for %s", async (_name, json) => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), fieldsAnswer(json)]);
      const repo = githubRepo("main", {
        updateOnStart: true,
        board: { ...board, inProgress: "In progress", abort: undefined },
      });
      const result = await doctor.ghBoardCheck(repo).run(fake.env);
      expect(result.status).toBe("warn");
      expect(result.remediation).toBe(fieldRemediation("main"));
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it.each([
      ["a missing option", ["Todo", "Done"]],
      ["multiple case-insensitive options", ["Todo", "In progress", "IN PROGRESS", "Done"]],
    ])("warns and names the configured key for %s", async (_name, options) => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        fieldsAnswer(fieldsJson(singleSelect("Status", options))),
      ]);
      const repo = githubRepo("main", {
        updateOnStart: true,
        board: { ...board, inProgress: "In progress", abort: undefined },
      });
      const result = await doctor.ghBoardCheck(repo).run(fake.env);
      expect(result.status).toBe("warn");
      expect(result.remediation).toBe(optionRemediation(configKey("inProgress")));
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it("warns with all keys when multiple configured options are missing", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        fieldsAnswer(fieldsJson(singleSelect("Status", ["Todo"]))),
      ]);
      const repo = githubRepo("main", {
        updateOnStart: true,
        updateOnFinish: true,
        board: { ...board, abort: undefined },
      });
      const result = await doctor.ghBoardCheck(repo).run(fake.env);
      expect(result.status).toBe("warn");
      expect(result.remediation).toBe(optionRemediation(`${configKey("inProgress")} and ${configKey("done")}`));
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it.each([
      ["invalid JSON", "not json"],
      ["missing fields", JSON.stringify({ totalCount: 0 })],
      [
        "a malformed single-select option",
        JSON.stringify({
          fields: [
            {
              id: "PVTSSF_lADOB9",
              name: "Status",
              type: "ProjectV2SingleSelectField",
              options: [{ id: "option-0", name: 3 }],
            },
          ],
          totalCount: 1,
        }),
      ],
    ])("returns an error for %s", async (_name, json) => {
      const fake = fakeGh(dir, {}, [ghTokenAnswer("octo", "gho_test"), fieldsAnswer(json)]);
      const result = await doctor.ghBoardCheck(githubRepo("main", { updateOnStart: true, board })).run(fake.env);
      expect(result.status).toBe("error");
      expect(result.remediation).toBeUndefined();
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it("returns an error when the account token call fails", async () => {
      const fake = fakeGh(dir, {}, [{ args: tokenArgs, stderr: "no oauth token found\n", exitCode: 1 }]);
      const result = await doctor.ghBoardCheck(githubRepo("main", { updateOnStart: true, board })).run(fake.env);
      expect(result).toEqual({
        status: "error",
        detail:
          "gh has no login for the account octo on github.com: run `gh auth login --hostname github.com` and log in as octo. gh said: no oauth token found",
      });
      expect(argLists(fake)).toEqual([tokenArgs]);
    });

    it("returns the timeout result when field-list is slow", async () => {
      const fake = fakeGh(dir, {}, [
        ghTokenAnswer("octo", "gho_test"),
        { ...fieldsAnswer(fieldsJson(singleSelect())), delaySeconds: 5 },
      ]);
      const start = Date.now();
      const result = await doctor.ghBoardCheck(githubRepo("main", { updateOnStart: true, board }), 200).run(fake.env);
      expect(result).toEqual({ status: "error", detail: "the check did not finish in 200 ms" });
      expect(Date.now() - start).toBeLessThan(2000);
      expect(argLists(fake)).toEqual([tokenArgs, boardArgs()]);
    });

    it("does not call gh when no board option qualifies", async () => {
      const fake = fakeGh(dir, {}, []);
      const repo = githubRepo("main", { board: { owner: "octo", number: 3, field: "Status" } });
      expect(await doctor.ghBoardCheck(repo).run(fake.env)).toEqual({
        status: "ok",
        detail: "main: no board option to check",
      });
      expect(fake.calls()).toEqual([]);
    });
  });

  describe("githubDoctorChecks", () => {
    const jiraRepo = () => {
      const { issueTracker } = githubRepo("j/jira");
      return { key: "j/jira", issueTracker: { ...issueTracker, provider: "jira" } as Tracker };
    };

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
      expect(checkSummaries(checks)).toEqual([
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

    it("puts each configured board check after that repo's labels check", () => {
      const checks = doctor.githubDoctorChecks([
        githubRepo("a/one", { board: { owner: "octo", number: 1, field: "Status" } }),
        githubRepo("a/two"),
        githubRepo("b/three", { account: "hubot", board: { owner: "hubot", number: 3, field: "Status" } }),
      ]);
      expect(checkSummaries(checks)).toEqual([
        { name: "gh version", required: true, timeoutMs: 5000 },
        { name: "gh auth: octo", required: true, timeoutMs: 15000 },
        { name: "gh auth: hubot", required: true, timeoutMs: 15000 },
        { name: "gh project: a/one", required: true, timeoutMs: 15000 },
        { name: "gh labels: a/one", required: true, timeoutMs: 15000 },
        { name: "gh board: a/one", required: true, timeoutMs: 15000 },
        { name: "gh project: a/two", required: true, timeoutMs: 15000 },
        { name: "gh labels: a/two", required: true, timeoutMs: 15000 },
        { name: "gh project: b/three", required: true, timeoutMs: 15000 },
        { name: "gh labels: b/three", required: true, timeoutMs: 15000 },
        { name: "gh board: b/three", required: true, timeoutMs: 15000 },
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
