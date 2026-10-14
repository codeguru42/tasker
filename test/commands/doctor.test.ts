import { existsSync, readdirSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { doctor } from "../../src/commands/doctor.js";
import { repoPaths } from "../../src/vcs/git/repo-paths.js";
import { createVcsProvider } from "../../src/vcs/provider.js";
import {
  type FakeGhAnswer,
  fakeGh,
  ghTokenAnswer,
  makeProviderFixture,
  runCommand,
  treeSnapshot,
  useFakeClaude,
  useProcessEnv,
  useTempDir,
  validConfig,
  writeTempConfig,
} from "../helpers.js";

const VERSION = { args: ["--version"], stdout: "gh version 2.101.0 (2026-09-15)\n" };
const LOGIN = { args: ["api", "user", "--jq", ".login"], stdout: "codeguru42\n" };
const PROJECT = { args: ["repo", "view", "codeguru42/tasker", "--json", "nameWithOwner"], stdout: "{}" };
const GOOD_GH: FakeGhAnswer[] = [VERSION, ghTokenAnswer("codeguru42", "gho_test"), LOGIN, PROJECT];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RawConfig = Record<string, any>;

// The PATH of the test, without the folders of a real claude of the host.
function pathWithoutClaude(): string {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((folder) => !existsSync(join(folder, "claude")))
    .join(delimiter);
}

async function setUp(
  answers: readonly FakeGhAnswer[],
  change: (raw: RawConfig) => void = () => {},
  withClaude = true,
) {
  const fixture = await makeProviderFixture();
  onTestFinished(fixture.remove);
  const dir = useTempDir("tasker-doctor-");
  const fake = fakeGh(dir, {}, answers);
  const raw = validConfig();
  raw.dataRoot = fixture.context.dataRoot;
  raw.dataRootMinFreeBytes = 1;
  raw.repos.tasker.remote = fixture.origin.path;
  raw.repos.tasker.issueTracker.project = "codeguru42/tasker";
  change(raw);
  const written = writeTempConfig(raw);
  onTestFinished(() => rmSync(written.dir, { recursive: true, force: true }));
  const claudeBins = withClaude ? [useFakeClaude({ version: { stdout: "2.1.299 (Claude Code)\n" } }).binDir] : [];
  useProcessEnv({
    ...fixture.origin.env,
    PATH: [join(dir, "bin"), ...claudeBins, pathWithoutClaude()].join(delimiter),
    TASKER_CONFIG: written.path,
  });
  return { fixture, fake };
}

const statusLines = (out: string) => out.split("\n").filter((line) => line !== "" && !line.startsWith(" "));

describe("doctor", () => {
  it("gives 0 and eleven ok lines in order for a good setup", async () => {
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
    ];
    const lines = statusLines(out);
    expect(lines).toHaveLength(names.length);
    names.forEach((name, index) => expect(lines[index]).toMatch(new RegExp(`^ok    ${name}`)));
  });

  it("gives 1 and the fix when claude is not on PATH", async () => {
    await setUp(GOOD_GH, () => {}, false);

    const { code, out } = await runCommand(doctor, "doctor");

    expect(code).toBe(1);
    const lines = out.split("\n");
    const at = lines.findIndex((line) => line.startsWith("error claude version"));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1]).toMatch(/^ {6}.*Install Claude Code and put claude on PATH\./);
    expect(statusLines(out).filter((line) => line.startsWith("ok "))).toHaveLength(10);
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
    } as Parameters<typeof createVcsProvider>[0]).provision(fixture.context);
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
    expect(readdirSync(fixture.context.dataRoot).sort()).toEqual(["artifacts", "clones"]);
  });
});
