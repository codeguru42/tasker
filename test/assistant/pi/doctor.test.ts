import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The pi doctor module is added by the green todo.
import {
  piAuthCheck as fromPiAuthCheck,
  piVersionCheck as fromPiVersionCheck,
  simpleEnglishCheck as fromSimpleEnglishCheck,
  superpowersCheck as fromSuperpowersCheck,
} from "../../../src/assistant/pi/doctor.js";
import { createPiProvider as fromCreatePiProvider } from "../../../src/assistant/pi/provider.js";
import type { AssistantDoctorRepo, AssistantProvider } from "../../../src/assistant/provider.js";
import type { Check } from "../../../src/doctor/check.js";
import { checkSummaries } from "../../helpers/doctor.js";
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
const superpowersInstall = "Install superpowers with pi install git:github.com/obra/superpowers.";
const NOT_INSTALLED = {
  status: "error",
  detail: "pi is not installed or not on PATH",
  remediation: piInstallFix,
};

function createPiProvider(): AssistantProvider {
  return fromCreatePiProvider();
}

function piVersionCheck(timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return fromPiVersionCheck(timeoutMs) as Check;
}

function piAuthCheck(upstream: string, timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return fromPiAuthCheck(upstream, timeoutMs) as Check;
}

function superpowersCheck(timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return fromSuperpowersCheck(timeoutMs) as Check;
}

function simpleEnglishCheck(timeoutMs?: number): Check {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return fromSimpleEnglishCheck(timeoutMs) as Check;
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
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: `${VERSION}\nmore\n` }]);

    expect(await piVersionCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({ status: "ok", detail: VERSION });
    expect(fake.calls().map((call) => call.args)).toEqual([VERSION_ARGS]);
  });

  it("gives the install fix when pi is not on PATH", async () => {
    const emptyBin = useTempDir("tasker-empty-pi-bin-");

    expect(await piVersionCheck().run({ PATH: emptyBin, HOME: "/home/user" })).toEqual(NOT_INSTALLED);
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

    expect(await piVersionCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
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

    expect(await makeCheck().run({ ...fake.env, HOME: "/home/user", TASKER_PI_CODING_AGENT_DIR: "rel/x" })).toEqual({
      status: "error",
      detail: relativeFolderReason,
      remediation: agentFolderFix,
    });
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    ["pi version", () => piVersionCheck()],
    ["pi auth", () => piAuthCheck("openrouter")],
    ["superpowers", () => superpowersCheck()],
  ])("reports missing HOME before spawn for %s", async (_name, makeCheck) => {
    const fake = useFakePi([{ args: VERSION_ARGS, stdout: VERSION }]);

    expect(await makeCheck().run(fake.env)).toEqual({
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
      detail: "pi has a login for openrouter",
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

    expect(await piAuthCheck(upstream).run({ ...fake.env, HOME: "/home/user" })).toMatchObject({
      status: "error",
      detail: expect.stringContaining("provider_not_found"),
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

    expect(await piAuthCheck(upstream).run({ ...fake.env, HOME: "/home/user" })).toMatchObject({
      status: "error",
      remediation: "Run /login in pi and select openrouter.",
    });
  });
});

describe("superpowersCheck", () => {
  it("gives the install fix when the list is empty", async () => {
    const fake = useFakePi([{ args: LIST_ARGS, stdout: "No packages installed.\n" }]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toEqual({
      status: "error",
      detail: "superpowers is not installed",
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
      detail: "superpowers 6.4.1 is installed",
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
      remediation: "Update superpowers with pi install git:github.com/obra/superpowers.",
    });
  });

  it("ignores a user package when the list has no install path", async () => {
    const fake = useFakePi([
      { args: LIST_ARGS, stdout: listOutput("User packages", "git:github.com/obra/superpowers") },
    ]);

    expect(await superpowersCheck().run({ ...fake.env, HOME: "/home/user" })).toMatchObject({
      status: "error",
      detail: "superpowers is not installed",
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
      detail: "superpowers is not installed",
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
      detail: "simple-english is installed for pi",
    });
  });

  it("reports missing simple-english", async () => {
    const home = useTempDir("tasker-simple-english-empty-");

    expect(await simpleEnglishCheck().run({ HOME: home })).toEqual({
      status: "error",
      detail: "simple-english is not installed for pi",
      remediation: "Install simple-english in $HOME/.agents/skills/ or the pi agent folder.",
    });
  });

  it("checks the user skill folder when the agent folder is refused", async () => {
    const home = useTempDir("tasker-simple-english-home-");
    addSkill(join(home, ".agents", "skills"));

    expect(await simpleEnglishCheck().run({ HOME: home, TASKER_PI_CODING_AGENT_DIR: "rel/x" })).toEqual({
      status: "ok",
      detail: "simple-english is installed for pi",
    });
  });

  it("does not use $HOME/.agents/skills when HOME is unset", async () => {
    expect(await simpleEnglishCheck().run({})).toMatchObject({ status: "error" });
  });
});
