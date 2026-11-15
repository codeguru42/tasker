import { mkdirSync, realpathSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PiSandboxLimits } from "../../../src/assistant/pi/guard-limits.js";
import { piFolderRefusal } from "../../../src/assistant/pi/pi-folders.js";
import { piSandboxLimits } from "../../helpers/pi-sandbox.js";
import { useTempDir } from "../../helpers/temp.js";

const SUFFIX = "Keep each write path of the run out of the folders of pi.";
const PREFIX = "a write path of the run overlaps a folder of pi: ";
const WORKTREE = "the worktree";
const WRITE_PATH = "a path of sandbox.allowWrite";
const TEMP = "the temp folder of the start";

interface Layout {
  root: string;
  home: string;
  agentDir: string;
  piFolder: string;
}

function layout(): Layout {
  const root = realpathSync(useTempDir("tasker-pi-folders-"));
  const home = join(root, "home");
  const piFolder = join(home, ".pi");
  const agentDir = join(piFolder, "agent");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(join(root, "work"));
  mkdirSync(join(root, "start"));
  return { root, home, agentDir, piFolder };
}

function sandbox(root: string, overrides: Partial<PiSandboxLimits> = {}): PiSandboxLimits {
  return piSandboxLimits({ worktree: join(root, "work"), tempFolder: join(root, "start"), ...overrides });
}

function callRefusal(agentDir: string, home: string | undefined, part: PiSandboxLimits): string | undefined {
  return piFolderRefusal(agentDir, home, part);
}

describe("piFolderRefusal", () => {
  it("passes when no write path touches a folder of pi", () => {
    const { root, home, agentDir } = layout();

    expect(callRefusal(agentDir, home, sandbox(root, { writePaths: [join(root, "other")] }))).toBeUndefined();
  });

  it.each([
    ["equals the agent folder", (l: Layout) => l.agentDir],
    ["lies under the agent folder", (l: Layout) => join(l.agentDir, "sessions")],
    ["contains the agent folder", (l: Layout) => l.piFolder],
  ])("refuses a write path that %s", (_name, pick) => {
    const l = layout();
    const path = pick(l);
    const folders = `${l.agentDir} (${WRITE_PATH}), ${l.piFolder} (${WRITE_PATH})`;

    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { writePaths: [path] }))).toBe(
      `${PREFIX}${folders}. ${SUFFIX}`,
    );
  });

  it("refuses a write path under $HOME/.pi that is outside the agent folder", () => {
    const l = layout();
    const customAgent = join(l.root, "custom-agent");
    mkdirSync(customAgent);

    expect(callRefusal(customAgent, l.home, sandbox(l.root, { writePaths: [join(l.piFolder, "other")] }))).toBe(
      `${PREFIX}${l.piFolder} (${WRITE_PATH}). ${SUFFIX}`,
    );
  });

  it("refuses a temp folder that equals, contains or lies under a folder of pi", () => {
    const l = layout();
    const under = join(l.agentDir, "tmp-start");
    const piReason = (kind: string) => `${PREFIX}${l.agentDir} (${kind}), ${l.piFolder} (${kind}). ${SUFFIX}`;

    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { tempFolder: l.piFolder }))).toBe(piReason(TEMP));
    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { tempFolder: under }))).toBe(piReason(TEMP));
    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { tempFolder: l.home }))).toBe(piReason(TEMP));
  });

  it("refuses a worktree that equals or lies under a folder of pi", () => {
    const l = layout();

    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { worktree: l.agentDir }))).toBe(
      `${PREFIX}${l.agentDir} (${WORKTREE}), ${l.piFolder} (${WORKTREE}). ${SUFFIX}`,
    );
    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { worktree: join(l.agentDir, "repo") }))).toBe(
      `${PREFIX}${l.agentDir} (${WORKTREE}), ${l.piFolder} (${WORKTREE}). ${SUFFIX}`,
    );
  });

  it("lets a worktree contain a folder of pi", () => {
    const l = layout();

    expect(callRefusal(l.agentDir, l.home, sandbox(l.root, { worktree: l.home }))).toBeUndefined();
  });

  it("lets paths under <worktree>/.pi pass", () => {
    const l = layout();
    const worktree = join(l.root, "work");
    mkdirSync(join(worktree, ".pi"));

    expect(
      callRefusal(l.agentDir, l.home, sandbox(l.root, { writePaths: [join(worktree, ".pi", "x")] })),
    ).toBeUndefined();
  });

  it("lists two kinds for one folder in a fixed order", () => {
    const l = layout();
    const part = sandbox(l.root, { worktree: l.agentDir, writePaths: [l.agentDir], tempFolder: l.agentDir });

    expect(callRefusal(l.agentDir, l.home, part)).toBe(
      `${PREFIX}${l.agentDir} (${WORKTREE}, ${WRITE_PATH}, ${TEMP}), ${l.piFolder} (${WORKTREE}, ${WRITE_PATH}, ${TEMP}). ${SUFFIX}`,
    );
  });

  it("follows an agent folder link and reports the given path", () => {
    const l = layout();
    const agentLink = join(l.root, "agent-link");
    symlinkSync(l.agentDir, agentLink);

    expect(callRefusal(agentLink, l.home, sandbox(l.root, { writePaths: [join(l.agentDir, "sessions")] }))).toBe(
      `${PREFIX}${agentLink} (${WRITE_PATH}), ${l.piFolder} (${WRITE_PATH}). ${SUFFIX}`,
    );
  });

  it("follows a $HOME/.pi link and reports the given path", () => {
    const root = realpathSync(useTempDir("tasker-pi-folders-home-link-"));
    const home = join(root, "home");
    const target = join(root, "pi-target");
    const agentDir = join(root, "agent");
    for (const folder of [home, target, agentDir, join(root, "work"), join(root, "start")]) mkdirSync(folder);
    const link = join(home, ".pi");
    symlinkSync(target, link);

    expect(callRefusal(agentDir, home, sandbox(root, { writePaths: [join(target, "x")] }))).toBe(
      `${PREFIX}${link} (${WRITE_PATH}). ${SUFFIX}`,
    );
  });

  it("lists equal real folders once", () => {
    const l = layout();
    const part = sandbox(l.root, { writePaths: [l.piFolder] });

    expect(callRefusal(l.piFolder, l.home, part)).toBe(`${PREFIX}${l.piFolder} (${WRITE_PATH}). ${SUFFIX}`);
  });

  it("passes when $HOME/.pi is missing", () => {
    const root = realpathSync(useTempDir("tasker-pi-folders-missing-"));
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    mkdirSync(home);
    mkdirSync(agentDir);

    expect(callRefusal(agentDir, home, sandbox(root, { writePaths: [join(root, "other")] }))).toBeUndefined();
  });

  it("refuses with the real path failure of a dangling $HOME/.pi", () => {
    const root = realpathSync(useTempDir("tasker-pi-folders-dangling-"));
    const home = join(root, "home");
    const agentDir = join(root, "agent");
    mkdirSync(home);
    mkdirSync(agentDir);
    symlinkSync(join(root, "gone"), join(home, ".pi"));

    expect(callRefusal(agentDir, home, sandbox(root))).toBe(
      `tasker cannot find the real path of ${join(home, ".pi")}: ENOENT`,
    );
  });

  it("refuses with the real path failure of a dangling agent folder", () => {
    const root = realpathSync(useTempDir("tasker-pi-folders-agent-dangling-"));
    const agentDir = join(root, "agent");
    symlinkSync(join(root, "gone"), agentDir);

    expect(callRefusal(agentDir, undefined, sandbox(root))).toBe(
      `tasker cannot find the real path of ${agentDir}: ENOENT`,
    );
  });

  it("ignores an absent or relative HOME", () => {
    const l = layout();
    const part = sandbox(l.root, { writePaths: [l.piFolder] });

    expect(callRefusal(join(l.root, "other-agent"), undefined, part)).toBeUndefined();
    expect(callRefusal(join(l.root, "other-agent"), "relative/home", part)).toBeUndefined();
  });
});
