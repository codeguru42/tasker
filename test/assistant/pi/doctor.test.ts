import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { relative } from "node:path";
import {
  piAuthCheck as fromPiAuthCheck,
  piVersionCheck as fromPiVersionCheck,
  simpleEnglishCheck as fromSimpleEnglishCheck,
  superpowersCheck as fromSuperpowersCheck,
} from "../../../src/assistant/pi/doctor.js";
import type { AssistantDoctorRepo } from "../../../src/assistant/provider.js";
import type { Check } from "../../../src/doctor/check.js";
import { checkSummaries } from "../../helpers/doctor.js";
import { createPiProvider } from "../../helpers/pi-provider.js";
import { useFakePi } from "../../helpers/fake-pi.js";
import { validConfig } from "../../helpers/config.js";
import { parseConfig } from "../../../src/config/schema.js";
import { useTempDir, writeFileWithParents } from "../../helpers/temp.js";

const VERSION = "1.1.0";
const VERSION_ARGS = ["--version"];
const LIST_ARGS = ["list", "--no-approve"];
const authArgs = (upstream: string) => ["auth", "check", "--provider", upstream, "--json"];
const relativeFolderReason = "TASKER_PI_CODING_AGENT_DIR must be an absolute path, got rel/x";
const missingHomeReason = "tasker cannot find the agent folder of pi, because HOME is not set";
const agentFolderFix = "Set TASKER_PI_CODING_AGENT_DIR to an absolute path, or unset it.";
const homeFix = "Set HOME.";
const piInstallFix = "Install pi and put pi on PATH, or set TASKER_PI_BIN.";
const superpowersInstall = "Run pi install git:github.com/obra/superpowers.";
const NOT_INSTALLED = {
  status: "error",
  detail: "pi is not installed or not on PATH",
  remediation: piInstallFix,
};

function piVersionCheck(timeoutMs?: number): Check {
  return fromPiVersionCheck(timeoutMs);
}

function piAuthCheck(upstream: string, timeoutMs?: number): Check {
  return fromPiAuthCheck(upstream, timeoutMs);
}

function superpowersCheck(timeoutMs?: number): Check {
  return fromSuperpowersCheck(timeoutMs);
}

function simpleEnglishCheck(timeoutMs?: number): Check {
  return fromSimpleEnglishCheck(timeoutMs);
}

function piRepo(key: string, models: [string, string, string]): AssistantDoctorRepo {
  const raw = validConfig();
  raw.repos.tasker.assistant.provider = "pi";
  raw.repos.tasker.assistant.models.plan.model = models[0];
  raw.repos.tasker.assistant.models.execute.model = models[1];
  raw.repos.tasker.assistant.models.review.model = models[2];
  return { key, assistant: parseConfig(raw, {}, "/home/me").repos.tasker.assistant };
}

function listOutput(section: string, source: string, installPath?: string): string {
  return `${section}:\n  ${source}\n${installPath === undefined ? "" : `    ${installPath}\n`}`;
}

function addSuperpowersPackage(installPath: string, version: string): void {
  writeFileWithParents(join(installPath, "package.json"), JSON.stringify({ name: "superpowers", version }));
}

function addSkill(folder: string): void {
  writeFileWithParents(join(folder, "simple-english", "SKILL.md"), "---\nname: simple-english\n---\n");
}

describe("pi doctor check selection", () => {
  it("gives checks in order and adds each upstream at first use", () => {
    const checks = createPiProvider().doctorChecks([
      piRepo("a", ["openrouter/a", "anthropic/b", "openrouter/c"]),
      piRepo("b", ["google/d", "anthropic/e", "google/f"]),
    ]);

    expect(checkSummaries(checks)).toEqual([
      { name: "pi version", required: true, timeoutMs: 5000 },
      { name: "pi-auth:openrouter", required: true, timeoutMs: 10000 },
      { name: "pi-auth:anthropic", required: true, timeoutMs: 10000 },
      { name: "pi-auth:google", required: true, timeoutMs: 10000 },
      { name: "superpowers:pi", required: true, timeoutMs: 5000 },
      { name: "simple-english:pi", required: true, timeoutMs: 1000 },
    ]);
  });

  it("gives no checks when there are no repos", () => {
    expect(createPiProvider().doctorChecks([])).toEqual([]);
  });

  it("uses the required timeout for each individual check", () => {
    expect(
      checkSummaries([piVersionCheck(), piAuthCheck("openrouter"), superpowersCheck(), simpleEnglishCheck()]),
    ).toEqual([
      { name: "pi version", required: true, timeoutMs: 5000 },
      { name: "pi-auth:openrouter", required: true, timeoutMs: 10000 },
      { name: "superpowers:pi", required: true, timeoutMs: 5000 },
      { name: "simple-english:pi", required: true, timeoutMs: 1000 },
    ]);
  });
});

describe("piVersionCheck", () => {
  it("gives ok with the first line of the version", async () => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: `pi ${VERSION}\nmore\n` }]);

    expect(await piVersionCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "ok",
      detail: `pi ${VERSION}`,
    });
    expect(fake.calls().map((call) => call.args)).toEqual([VERSION_ARGS]);
  });

  it("gives the install fix when pi is not on PATH", async () => {
    const emptyBin = useTempDir("tasker-empty-pi-bin-");

    expect(await piVersionCheck().run({ PATH: emptyBin, HOME: "/home/user" })).toEqual(NOT_INSTALLED);
  });

  it("names TASKER_PI_BIN when the configured program is not on PATH", async () => {
    const emptyBin = useTempDir("tasker-empty-pi-bin-");

    expect(await piVersionCheck().run({ PATH: emptyBin, TASKER_PI_BIN: "custom-pi", HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "custom-pi is not installed or not on PATH",
      remediation: piInstallFix,
    });
  });

  it("uses the first line of stderr for a nonzero exit", async () => {
    const fake = useFakePi([{ args: VERSION_ARGS, exitCode: 3, stderr: "broken install\nmore detail\n" }]);

    expect(await piVersionCheck().run({ ...fake.env, TASKER_PI_BIN: undefined, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi --version exited 3: broken install",
    });
  });

  it("uses TASKER_PI_BIN to start pi", async () => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: `${VERSION}\n` }]);
    const emptyBin = useTempDir("tasker-empty-pi-bin-");

    const result = await piVersionCheck().run({
      ...fake.env,
      PATH: emptyBin,
      TASKER_PI_BIN: fake.env.TASKER_PI_BIN,
      HOME: "/home/user",
    });

    expect(result).toEqual({ status: "ok", detail: VERSION });
    expect(fake.calls().map((call) => call.args)).toEqual([VERSION_ARGS]);
  });

  it("reports a bad TASKER_PI_BIN value with its fix", async () => {
    const folder = useTempDir("tasker-bad-pi-bin-");
    const program = join(folder, "pi");
    writeFileWithParents(program, "not executable");

    expect(await piVersionCheck().run({ PATH: folder, TASKER_PI_BIN: program, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: `TASKER_PI_BIN is ${program}, but ${program} is not a file that you can run`,
      remediation: "Fix TASKER_PI_BIN.",
    });
  });

  it("gives the timeout result when pi is slow", async () => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: VERSION, delaySeconds: 0.5 }]);

    expect(await piVersionCheck(100).run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "the check did not finish in 100 ms",
    });
  });

  it("names the signal that stopped pi", async () => {
    const fake = useFakePi([{ args: VERSION_ARGS, killWith: "TERM" }]);

    expect(await piVersionCheck().run({ ...fake.env, TASKER_PI_BIN: undefined, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi --version was killed by SIGTERM",
    });
  });
});

describe("pi child refusals in doctor checks", () => {
  it.each([
    ["pi version", () => piVersionCheck()],
    ["pi auth", () => piAuthCheck("openrouter")],
    ["superpowers", () => superpowersCheck()],
  ])("reports a relative folder before spawn for %s", async (_name, makeCheck) => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: VERSION }]);

    expect(
      await makeCheck().run({
        ...fake.env,
        HOME: "/home/user",
        TASKER_PI_BIN: "/missing/pi",
        TASKER_PI_CODING_AGENT_DIR: "rel/x",
      }),
    ).toEqual({ status: "error", detail: relativeFolderReason, remediation: agentFolderFix });
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    ["pi version", () => piVersionCheck()],
    ["pi auth", () => piAuthCheck("openrouter")],
    ["superpowers", () => superpowersCheck()],
  ])("reports missing HOME before spawn for %s", async (_name, makeCheck) => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: VERSION }]);

    expect(await makeCheck().run({ ...fake.env, HOME: undefined, TASKER_PI_BIN: "/missing/pi" })).toEqual({
      status: "error",
      detail: missingHomeReason,
      remediation: homeFix,
    });
    expect(fake.calls()).toEqual([]);
  });

  it("passes only the pi child environment values to pi", async () => {
    const fake = useFakePi(
      [{ args: authArgs("openrouter"), stdout: JSON.stringify({ status: "ready", provider: "openrouter" }) }],
      ["PI_CODING_AGENT_DIR", "SECRET", "TASKER_PI_BIN"],
    );

    await piAuthCheck("openrouter").run({
      ...fake.env,
      HOME: "/home/user",
      TASKER_PI_CODING_AGENT_DIR: "/custom/pi-agent",
      SECRET: "secret",
    });

    expect(fake.calls().map((call) => call.env)).toEqual([
      { PI_CODING_AGENT_DIR: "/custom/pi-agent", SECRET: undefined, TASKER_PI_BIN: undefined },
    ]);
  });
});

describe("piAuthCheck", () => {
  const authExitDetail = (program: string, upstream: string, code: number) =>
    `${program} auth check --provider ${upstream} --json exited ${code}`;

  it("checks auth without secret-printing or no-refresh flags", async () => {
    const upstream = "openrouter";
    const fake = useFakePi([
      {
        args: authArgs(upstream),
        stdout: JSON.stringify({ status: "ready", provider: upstream, authType: "oauth" }),
      },
    ]);

    expect(await piAuthCheck(upstream).run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "ok",
      detail: "pi has credentials for openrouter (oauth)",
    });
    expect(fake.calls().map((call) => call.args)).toEqual([authArgs(upstream)]);
  });

  it("reports an unknown upstream", async () => {
    const upstream = "nosuchprov";
    const fake = useFakePi([
      {
        args: authArgs(upstream),
        exitCode: 1,
        stdout: JSON.stringify({ status: "not_ready", provider: upstream, reason: "provider_not_found" }),
      },
    ]);

    expect(await piAuthCheck(upstream).run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi does not know the provider nosuchprov",
      remediation: "Fix the model of each role that names nosuchprov.",
    });
  });

  it("gives the login fix when credentials are missing", async () => {
    const upstream = "openrouter";
    const fake = useFakePi([
      {
        args: authArgs(upstream),
        exitCode: 1,
        stdout: JSON.stringify({ status: "not_ready", provider: upstream, reason: "credentials_not_configured" }),
      },
    ]);

    expect(await piAuthCheck(upstream).run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi has no credentials for openrouter",
      remediation: "Run pi and log in to openrouter with /login.",
    });
  });

  it.each(["null", "[]", "false", "malformed"])("uses exit detail for JSON %s", async (stdout) => {
    const fake = useFakePi([{ args: authArgs("openrouter"), exitCode: 2, stdout }]);

    expect(await piAuthCheck("openrouter").run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: authExitDetail(fake.env.TASKER_PI_BIN!, "openrouter", 2),
    });
  });

  it.each([
    [{ status: "ready" }, 0, { status: "ok", detail: "pi has credentials for openrouter (unknown auth type)" }],
    [{ status: "ready", authType: "oauth" }, 0, { status: "ok", detail: "pi has credentials for openrouter (oauth)" }],
    [
      { reason: "provider_not_found" },
      1,
      {
        status: "error",
        detail: "pi does not know the provider openrouter",
        remediation: "Fix the model of each role that names openrouter.",
      },
    ],
    [
      { reason: "credentials_not_configured" },
      1,
      {
        status: "error",
        detail: "pi has no credentials for openrouter",
        remediation: "Run pi and log in to openrouter with /login.",
      },
    ],
    [
      { status: "expired", reason: "bad_token" },
      1,
      { status: "error", detail: "pi cannot use the credentials for openrouter: expired (bad_token)" },
    ],
    [
      { status: "expired", reason: 7 },
      1,
      { status: "error", detail: "pi cannot use the credentials for openrouter: expired" },
    ],
    [{ status: "expired" }, 0, { status: "error", detail: "pi cannot use the credentials for openrouter: expired" }],
  ] as const)("handles auth reply %j", async (reply, exitCode, expected) => {
    const fake = useFakePi([{ args: authArgs("openrouter"), exitCode, stdout: JSON.stringify(reply) }]);

    expect(await piAuthCheck("openrouter").run({ ...fake.env, HOME: "/home/user" })).toEqual(expected);
  });

  it("uses exit detail for a ready reply with a nonzero exit", async () => {
    const fake = useFakePi([{ args: authArgs("openrouter"), exitCode: 1, stdout: '{"status":"ready"}' }]);

    expect(await piAuthCheck("openrouter").run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: authExitDetail(fake.env.TASKER_PI_BIN!, "openrouter", 1),
    });
  });
});

describe("superpowersCheck", () => {
  it("gives the install fix when the list is empty", async () => {
    const fake = useFakePi([{ args: LIST_ARGS, stdout: "No packages installed.\n" }]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi has no superpowers package",
      remediation: superpowersInstall,
    });
  });

  it.each([
    ["git:github.com/obra/superpowers#v6.4.1", "6.4.1"],
    ["npm:superpowers@^6.4.1", "6.4.1"],
  ])("accepts source %s with version %s", async (source, version) => {
    const folder = useTempDir("tasker-superpowers-");
    addSuperpowersPackage(folder, version);
    const fake = useFakePi([{ args: LIST_ARGS, stdout: listOutput("User packages", source, folder) }]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "ok",
      detail: `superpowers ${version} at ${folder}`,
    });
  });

  it("requires superpowers version 6.4.1 or later and gives the install fix", async () => {
    const folder = useTempDir("tasker-superpowers-old-");
    addSuperpowersPackage(folder, "6.4.0");
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/obra/superpowers", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "superpowers 6.4.0 is older than 6.4.1",
      remediation:
        "Run pi update --extension git:github.com/obra/superpowers. If git:github.com/obra/superpowers names a ref or a version, run pi install with the source that names none.",
    });
  });

  it("ignores a user package when the list has no install path", async () => {
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/obra/superpowers") },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toMatchObject({
      status: "error",
      detail: "pi has no superpowers package",
    });
  });

  it("ignores a package entry when its package file is missing", async () => {
    const folder = useTempDir("tasker-superpowers-missing-package-file-");
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/obra/superpowers", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi has no superpowers package",
      remediation: superpowersInstall,
    });
  });

  it("ignores a project package even when it has an install path", async () => {
    const folder = useTempDir("tasker-superpowers-project-");
    addSuperpowersPackage(folder, "6.4.1");
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("Project packages", "git:github.com/obra/superpowers", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toMatchObject({
      status: "error",
      detail: "pi has no superpowers package",
    });
  });

  it("finds superpowers by package metadata, not by source", async () => {
    const folder = useTempDir("tasker-superpowers-match-");
    writeFileWithParents(
      join(folder, "package.json"),
      JSON.stringify({ name: "superpowers", version: "6.4.1-beta.1" }),
    );
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/acme/tool", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "ok",
      detail: `superpowers 6.4.1-beta.1 at ${folder}`,
    });
  });

  it("ignores a source whose package metadata names another package", async () => {
    const folder = useTempDir("tasker-superpowers-wrong-name-");
    writeFileWithParents(join(folder, "package.json"), JSON.stringify({ name: "@scope/other", version: "6.4.1" }));
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "npm:@scope/superpowers", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi has no superpowers package",
      remediation: superpowersInstall,
    });
  });

  it.each(['{"name":"superpowers"}', '{"name":"superpowers","version":"v6.4.1"}'])(
    "reports missing or invalid package version %s",
    async (packageJson) => {
      const folder = useTempDir("tasker-superpowers-invalid-");
      writeFileWithParents(join(folder, "package.json"), packageJson);
      const fake = useFakePi([
        { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/acme/tool", folder) },
      ]);

      expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
        status: "error",
        detail: `cannot read the version of superpowers in ${join(folder, "package.json")}`,
      });
    },
  );

  it.each(["bad", "null", "[]", "{}"])("does not match invalid package metadata %s", async (packageJson) => {
    const folder = useTempDir("tasker-superpowers-invalid-metadata-");
    writeFileWithParents(join(folder, "package.json"), packageJson);
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/acme/tool", folder) },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "pi has no superpowers package",
      remediation: superpowersInstall,
    });
  });

  it("gives a local source a file update fix", async () => {
    const folder = useTempDir("tasker-superpowers-local-");
    addSuperpowersPackage(folder, "6.4.0");
    const fake = useFakePi([{ args: LIST_ARGS, stdout: listOutput("User packages", "file:../superpowers", folder) }]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "superpowers 6.4.0 is older than 6.4.1",
      remediation: `Update the files at ${folder}.`,
    });
  });

  it("removes the filtered marker from a source", async () => {
    const folder = useTempDir("tasker-superpowers-filtered-");
    addSuperpowersPackage(folder, "6.4.1");
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: `User packages:\n  npm:superpowers (filtered)\n    ${folder}\n` },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "ok",
      detail: `superpowers 6.4.1 at ${folder}`,
    });
  });
});

describe("simpleEnglishCheck", () => {
  it.each(["agent folder", "$HOME/.agents/skills"])("finds simple-english in the %s", async (location) => {
    const home = useTempDir("tasker-simple-english-home-");
    const agentDir = join(home, ".pi", "agent");
    const skillFolder = location === "agent folder" ? join(agentDir, "skills") : join(home, ".agents", "skills");
    addSkill(skillFolder);

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "ok",
      detail: `simple-english at ${join(skillFolder, "simple-english", "SKILL.md")}`,
    });
  });

  it("uses the user skill file when the agent SKILL.md path is a directory", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    const agentSkillPath = join(home, ".pi", "agent", "skills", "simple-english", "SKILL.md");
    mkdirSync(agentSkillPath, { recursive: true });
    addSkill(join(home, ".agents", "skills"));

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "ok",
      detail: `simple-english at ${join(home, ".agents", "skills", "simple-english", "SKILL.md")}`,
    });
  });

  it("checks the user skill folder when the agent skills path is a file", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    writeFileWithParents(join(home, ".pi", "agent", "skills"), "not a folder");
    addSkill(join(home, ".agents", "skills"));

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "ok",
      detail: `simple-english at ${join(home, ".agents", "skills", "simple-english", "SKILL.md")}`,
    });
  });

  it("reports missing simple-english when SKILL.md is only a directory", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    mkdirSync(join(home, ".pi", "agent", "skills", "simple-english", "SKILL.md"), { recursive: true });

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "error",
      detail: `simple-english/SKILL.md is in no skill folder of pi: ${join(home, ".pi", "agent", "skills")}, ${join(home, ".agents", "skills")}`,
      remediation: `Install the skill simple-english in ${join(home, ".agents", "skills")}.`,
    });
  });

  it("reports missing simple-english", async () => {
    const home = useTempDir("tasker-simple-english-empty-");

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "error",
      detail: `simple-english/SKILL.md is in no skill folder of pi: ${join(home, ".pi", "agent", "skills")}, ${join(home, ".agents", "skills")}`,
      remediation: `Install the skill simple-english in ${join(home, ".agents", "skills")}.`,
    });
  });

  it("checks the user skill folder when the agent folder is refused", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    addSkill(join(home, ".agents", "skills"));

    expect(await simpleEnglishCheck().run({ HOME: home, TASKER_PI_CODING_AGENT_DIR: "rel/x" })).toEqual({
      status: "ok",
      detail: `simple-english at ${join(home, ".agents", "skills", "simple-english", "SKILL.md")}`,
    });
  });

  it("skips a refused agent folder when it holds the skill", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    const agentDir = mkdtempSync(join(process.cwd(), ".pi-doctor-agent-"));
    onTestFinished(() => rmSync(agentDir, { recursive: true, force: true }));
    addSkill(join(agentDir, "skills"));

    expect(
      await simpleEnglishCheck().run({ HOME: home, TASKER_PI_CODING_AGENT_DIR: relative(process.cwd(), agentDir) }),
    ).toEqual({
      status: "error",
      detail: `simple-english/SKILL.md is in no skill folder of pi: ${join(home, ".agents", "skills")}`,
      remediation: `Install the skill simple-english in ${join(home, ".agents", "skills")}.`,
    });
  });

  it("does not use $HOME/.agents/skills when HOME is unset", async () => {
    expect(await simpleEnglishCheck().run({})).toEqual({
      status: "error",
      detail: "tasker cannot find the skill folders of pi, because HOME is not set",
    });
  });
});
