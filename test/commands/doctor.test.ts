import { readdirSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { doctor } from "../../src/commands/doctor.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { createVcsProvider } from "../../src/vcs/provider.js";
import { runCommand } from "../helpers/cli.js";
import { validConfig, writeTempConfig } from "../helpers/config.js";
import { useFakeClaude } from "../helpers/fake-claude.js";
import { usePathWithout, writeFakeSandboxPrograms } from "../helpers/fake-commands.js";
import { fakeGh, ghTokenAnswer, type FakeGhAnswer } from "../helpers/fake-gh.js";
import { makeProviderFixture } from "../helpers/git.js";
import { treeSnapshot, useProcessEnv, useTempDir } from "../helpers/temp.js";

const VERSION = { args: ["--version"], stdout: "gh version 2.101.0 (2026-09-15)\n" };
const LOGIN = { args: ["api", "user", "--jq", ".login"], stdout: "codeguru42\n" };
const PROJECT = { args: ["repo", "view", "codeguru42/tasker", "--json", "nameWithOwner"], stdout: "{}" };
const GOOD_GH: FakeGhAnswer[] = [VERSION, ghTokenAnswer("codeguru42", "gho_test"), LOGIN, PROJECT];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawConfig = Record<string, any>;

async function setUp(answers: readonly FakeGhAnswer[], change: (raw: RawConfig) => void = () => {}, withClaude = true) {
  const fixture = await makeProviderFixture();
  onTestFinished(fixture.remove);
  const dir = useTempDir("tasker-doctor-");
  const fake = fakeGh(dir, {}, answers);
  writeFakeSandboxPrograms(join(dir, "bin"));
  const raw = validConfig();
  raw.dataRoot = fixture.context.dataRoot;
  raw.dataRootMinFreeBytes = 1;
  raw.repos.tasker.remote = fixture.origin.path;
  raw.repos.tasker.issueTracker.project = "codeguru42/tasker";
  change(raw);
  const written = writeTempConfig(raw);
  onTestFinished(() => rmSync(written.dir, { recursive: true, force: true }));
  const hostPath = process.env.PATH ?? "";
  const toolPath = withClaude
    ? [useFakeClaude({ version: { stdout: "2.1.299 (Claude Code)\n" } }).binDir, hostPath]
    : [usePathWithout("claude", hostPath)];
  useProcessEnv({
    ...fixture.origin.env,
    PATH: [join(dir, "bin"), ...toolPath].join(delimiter),
    TASKER_CONFIG: written.path,
  });
  return { fixture, fake };
}

const OTHER_PROJECT = { ...PROJECT, args: ["repo", "view", "codeguru42/other", "--json", "nameWithOwner"] };

const setUpTwoRepos = () =>
  setUp([...GOOD_GH, OTHER_PROJECT], (raw) => {
    raw.repos.other = {
      ...raw.repos.tasker,
      issueTracker: { ...raw.repos.tasker.issueTracker, project: "codeguru42/other" },
    };
  });

const statusLines = (out: string) => out.split("\n").filter((line) => line !== "" && !line.startsWith(" "));

describe("doctor", () => {
  it("gives 0 and one ok line for each check in order for a good setup", async () => {
    await setUp(GOOD_GH);

    const { code, out, err } = await runCommand(doctor, "doctor");

    expect(err).toBe("");
    expect(code).toBe(0);
    const names = [
      "data root",
      "free space",
      "git version",
      "git identity: tasker",
      "git connection: tasker",
      "git lock files: tasker",
      "gh version",
      "gh auth: codeguru42",
      "gh project: tasker",
      "gh labels: tasker",
      "claude version",
      ...(process.platform === "linux" ? ["sandbox: bwrap", "sandbox: socat"] : []),
    ];
    const lines = statusLines(out);
    expect(lines).toHaveLength(names.length);
    names.forEach((name, index) => expect(lines[index]).toMatch(new RegExp(`^ok    ${name}`)));
  });

  it("runs gh version and gh auth once for two repos of the github tracker", async () => {
    const { fake } = await setUpTwoRepos();

    const { out } = await runCommand(doctor, "doctor");

    const lines = statusLines(out);
    expect(lines.filter((line) => line.includes(" gh version"))).toHaveLength(1);
    expect(lines.filter((line) => line.includes(" gh auth: codeguru42"))).toHaveLength(1);
    expect(fake.calls().filter((call) => call.args[0] === "--version")).toHaveLength(1);
    const ghVersionAt = lines.findIndex((line) => line.includes(" gh version"));
    const gitAfterGh = lines.slice(ghVersionAt).filter((line) => line.includes(" git "));
    expect(gitAfterGh).toEqual([]);
  });

  it("shows the git version check once for two git repos", async () => {
    await setUpTwoRepos();

    const { out } = await runCommand(doctor, "doctor");

    const lines = statusLines(out);
    expect(lines.filter((line) => line.includes(" git version"))).toHaveLength(1);
    const versionAt = lines.findIndex((line) => line.includes(" git version"));
    for (const name of ["identity", "connection", "lock files"]) {
      for (const key of ["tasker", "other"]) {
        const matching = lines.filter((line) => line.includes(` git ${name}: ${key}`));
        expect(matching).toHaveLength(1);
        expect(versionAt).toBeLessThan(lines.indexOf(matching[0]));
      }
    }
  });

  it("gives 1 and the fix when claude is not on PATH", async () => {
    await setUp(GOOD_GH, () => {}, false);

    const { code, out } = await runCommand(doctor, "doctor");

    expect(code).toBe(1);
    const lines = out.split("\n");
    const at = lines.findIndex((line) => line.startsWith("error claude version"));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(/^ {6}.*Install Claude Code and put claude on PATH\./);
    expect(statusLines(out).filter((line) => line.startsWith("ok "))).toHaveLength(
      process.platform === "linux" ? 12 : 10,
    );
  });

  it("gives 1, prints the loader error and runs no check when the configuration does not load", async () => {
    const { fake } = await setUp(GOOD_GH, (raw) => {
      delete raw.dataRoot;
    });

    const { code, out, err } = await runCommand(doctor, "doctor");

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("Invalid configuration");
    expect(fake.calls()).toEqual([]);
  });

  it("gives 1 when a required check gives error, and still runs the later checks", async () => {
    await setUp([{ ...VERSION, stdout: "gh version 2.39.0 (2023-11-01)\n" }, ...GOOD_GH.slice(1)]);

    const { code, out } = await runCommand(doctor, "doctor");

    expect(code).toBe(1);
    const lines = out.split("\n");
    const at = lines.findIndex((line) => line.startsWith("error gh version"));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(/^ {6}.*Install gh 2\.40\.0 or newer\./);
    for (const name of ["gh auth", "gh project", "gh labels"]) {
      expect(out).toContain(name);
    }
  });

  it("gives 0 when the results hold only a warn", async () => {
    await setUp(GOOD_GH, (raw) => {
      raw.dataRootMinFreeBytes = Number.MAX_SAFE_INTEGER;
    });

    const { code, out } = await runCommand(doctor, "doctor");

    expect(code).toBe(0);
    expect(statusLines(out).find((line) => line.includes("free space"))).toMatch(/^warn /);
  });

  it("gives 1, prints the build error and runs no check for a jira repo", async () => {
    const { fake } = await setUp(GOOD_GH, (raw) => {
      raw.repos.tasker.issueTracker.provider = "jira";
    });

    const { code, out, err } = await runCommand(doctor, "doctor");

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("the jira tracker is not available in this version");
    expect(fake.calls()).toEqual([]);
  });

  it("changes nothing at the remote, GitHub or the clone", async () => {
    const { fixture, fake } = await setUp(GOOD_GH);
    await createVcsProvider({
      remote: fixture.origin.path,
      vcs: { provider: "git", config: {} },
    }).provision(fixture.context);
    const clone = repoPaths(fixture.context.dataRoot, "tasker").clone;
    const originBefore = treeSnapshot(fixture.origin.path);
    const cloneBefore = treeSnapshot(clone);

    await runCommand(doctor, "doctor");

    expect(treeSnapshot(fixture.origin.path)).toEqual(originBefore);
    expect(treeSnapshot(clone)).toEqual(cloneBefore);
    const allowed = GOOD_GH.map((answer) => answer.args);
    for (const call of fake.calls()) {
      expect(allowed).toContainEqual(call.args);
    }
    expect(readdirSync(fixture.context.dataRoot).sort()).toEqual(["artifacts", "clones", "prompts"]);
  });
});
