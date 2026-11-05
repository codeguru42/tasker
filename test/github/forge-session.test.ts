import { relative } from "node:path";
import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createGhSession } from "../../src/github/forge-session.js";
import { failureOf, thrownBy } from "../helpers/errors.js";
import { forgeGh } from "../helpers/forge-gh.js";
import { writeFakeCommand } from "../helpers/fake-commands.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";

const answer = { args: ["repo", "view"], stdout: "repository" };
const taskerEnv = (ghPath: string | undefined, rest: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  TASKER_PATH: ghPath,
  TASKER_HOME: "/tasker/home",
  TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
  ...rest,
});
const run = (
  session: ReturnType<typeof createGhSession>,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
) => session.run(args, cwd, env);

describe("createGhSession", () => {
  it("throws for an empty account during construction", () => {
    const error = thrownBy(() => createGhSession(""), "an empty-account error");
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("account");
  });

  it.each([
    ["auth token", ["auth", "token"]],
    ["auth login", ["auth", "login"]],
    ["auth logout", ["auth", "logout"]],
    ["auth switch", ["auth", "switch"]],
    ["pr checkout", ["pr", "checkout", "42"]],
    ["repo sync", ["repo", "sync", "owner/repo"]],
    ["repo create with push", ["repo", "create", "new-repo", "--push"]],
    ["empty args", []],
    ["flag first", ["--repo", "owner/repo"]],
  ])("rejects %s before starting gh", async (_label, args) => {
    const dir = useTempDir("tasker-forge-filter-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(run(createGhSession("octo"), args, dir, taskerEnv(fake.env.PATH)), Error);
    expect(error.message).not.toBe("");
    expect(fake.calls()).toEqual([]);
  });

  it("accepts an unrelated repository command", async () => {
    const dir = useTempDir("tasker-forge-accepted-");
    const fake = forgeGh(dir, "token", [answer]);

    await expect(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH))).resolves.toBe(
      "repository",
    );
    expect(fake.calls().map((call) => call.args)).toEqual([["repo", "view"]]);
  });

  it.each([undefined, "", "  "])("requires a nonblank TASKER_PATH, got %j", async (path) => {
    const dir = useTempDir("tasker-forge-no-path-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(path)), Error);
    expect(error.message).toContain("TASKER_PATH");
    expect(fake.calls()).toEqual([]);
  });

  it.each([
    { TASKER_HOME: "", TASKER_GH_CONFIG_DIR: "" },
    { TASKER_HOME: "  ", TASKER_GH_CONFIG_DIR: undefined },
  ])("requires at least one nonblank authentication location", async (locations) => {
    const dir = useTempDir("tasker-forge-no-auth-location-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, { TASKER_PATH: fake.env.PATH, ...locations }),
      Error,
    );
    expect(error.message).toMatch(/TASKER_HOME|TASKER_GH_CONFIG_DIR/);
    expect(fake.calls()).toEqual([]);
  });

  it.each(["TASKER_GH_TOKEN", "TASKER_GH_HOST", "TASKER_GH_REPO"])("rejects supplied %s", async (name) => {
    const dir = useTempDir("tasker-forge-forbidden-");
    const fake = forgeGh(dir, "token", []);
    const error = await failureOf(
      run(createGhSession("octo"), ["repo", "view"], dir, taskerEnv(fake.env.PATH, { [name]: "bad" })),
      Error,
    );
    expect(error.message).toContain(name);
    expect(fake.calls()).toEqual([]);
  });

  it("uses only the allowlisted environment and fixed controls, with the supplied worktree", async () => {
    const dir = useTempDir("tasker-forge-environment-");
    const worktree = `${dir}/worktree`;
    mkdirSync(worktree);
    const fake = forgeGh(
      dir,
      "token",
      [answer],
      [
        "PATH",
        "TASKER_HOME",
        "TASKER_GH_CONFIG_DIR",
        "TASKER_GH_BIN",
        "GH_PROMPT_DISABLED",
        "GH_NO_UPDATE_NOTIFIER",
        "NO_COLOR",
        "GH_TOKEN",
        "HOME",
      ],
    );
    useProcessEnv({ PATH: "/ambient/path", HOME: "/ambient/home", GH_TOKEN: "ambient-token" });
    const supplied = taskerEnv(fake.env.PATH, {
      TASKER_GH_TOKEN: undefined,
      TASKER_GH_HOST: undefined,
      TASKER_GH_REPO: undefined,
      GH_TOKEN: "caller-token",
      GH_HOST: "ambient.example",
      GH_REPO: "ambient/repo",
      HOME: "/caller/home",
      TASKER_GH_BIN: fake.env.TASKER_GH_BIN,
    });
    const before = { ...supplied };

    await run(createGhSession("octo"), ["repo", "view"], worktree, supplied);

    expect(fake.calls()).toEqual([
      {
        args: ["repo", "view"],
        tokenMatches: false,
        cwd: worktree,
        env: {
          PATH: fake.env.PATH,
          TASKER_HOME: "/tasker/home",
          TASKER_GH_CONFIG_DIR: "/tasker/gh-config",
          TASKER_GH_BIN: undefined,
          GH_PROMPT_DISABLED: "1",
          GH_NO_UPDATE_NOTIFIER: "1",
          NO_COLOR: "1",
          GH_TOKEN: undefined,
          HOME: undefined,
        },
      },
    ]);
    expect(supplied).toEqual(before);
  });

  it.each(["bare", "absolute", "relative", "blank"])("uses a %s executable override", async (kind) => {
    const dir = useTempDir("tasker-forge-program-");
    const fake = forgeGh(dir, "token", [answer]);
    const taskerPath = useTempDir("tasker-forge-tasker-path-");
    writeFakeCommand(taskerPath, "selected-gh", `exec "${fake.env.TASKER_GH_BIN!}" "$@"`);
    const path = kind === "bare" ? taskerPath : fake.env.PATH!;
    const executable =
      kind === "bare"
        ? "selected-gh"
        : kind === "absolute"
          ? fake.env.TASKER_GH_BIN
          : kind === "relative"
            ? relative(process.cwd(), fake.env.TASKER_GH_BIN!)
            : "  ";

    await expect(
      run(createGhSession("octo"), ["repo", "view"], dir, {
        ...taskerEnv(path),
        ...(kind === "blank" ? { TASKER_GH_BIN: executable } : { TASKER_GH_BIN: executable }),
      }),
    ).resolves.toBe("repository");
    expect(fake.calls().map((call) => call.args)).toEqual([["repo", "view"]]);
  });
});
