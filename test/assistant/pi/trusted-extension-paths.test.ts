import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PiSandboxLimits } from "../../../src/assistant/pi/guard-limits.js";
import { trustedExtensionRefusal } from "../../../src/assistant/pi/trusted-extension-paths.js";
import { piSandboxLimits } from "../../helpers/pi-sandbox.js";
import { useTempDir } from "../../helpers/temp.js";

const PREFIX = "pi can load trusted extensions that the run can change: ";
const SUFFIX = "Move each extension out of the write paths of the run.";
const WORKTREE = "in the worktree";
const WRITE_PATH = "in a path of sandbox.allowWrite";
const TEMP = "in the temp folder of the start";

interface Layout {
  root: string;
  agentDir: string;
  worktree: string;
  temp: string;
}

function layout(settings?: unknown): Layout {
  const root = realpathSync(useTempDir("tasker-pi-ext-paths-"));
  const agentDir = join(root, "agent");
  const worktree = join(root, "work");
  const temp = join(root, "start");
  for (const folder of [agentDir, worktree, temp]) mkdirSync(folder);
  if (settings !== undefined) writeFileSync(join(agentDir, "settings.json"), JSON.stringify(settings));
  return { root, agentDir, worktree, temp };
}

function sandbox(l: Layout, overrides: Partial<PiSandboxLimits> = {}): PiSandboxLimits {
  return piSandboxLimits({ worktree: l.worktree, tempFolder: l.temp, ...overrides });
}

function callRefusal(l: Layout, trusted: string[], part: PiSandboxLimits): string | undefined {
  return trustedExtensionRefusal(l.agentDir, trusted, part);
}

function reason(details: string): string {
  return `${PREFIX}${details}. ${SUFFIX}`;
}

describe("trustedExtensionRefusal", () => {
  it("passes when no trusted extension is in a write path", () => {
    const l = layout({ extensions: ["/elsewhere/ext.js"], packages: ["npm:pkg"] });

    expect(callRefusal(l, ["/elsewhere/ext.js", "npm:pkg"], sandbox(l))).toBeUndefined();
  });

  it("refuses a folder extension in an allowed write path", () => {
    const l = layout();
    mkdirSync(join(l.agentDir, "extensions"));
    const key = join(l.agentDir, "extensions", "a.js");
    writeFileSync(key, "");

    expect(callRefusal(l, [key], sandbox(l, { writePaths: [join(l.agentDir, "extensions")] }))).toBe(
      reason(`${key} (${WRITE_PATH})`),
    );
  });

  it("refuses an absolute settings extension in the worktree", () => {
    const l = layout();
    const absolute = join(l.worktree, "ext.js");
    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [absolute] }));

    expect(callRefusal(l, [absolute], sandbox(l))).toBe(reason(`${absolute} (${WORKTREE})`));
  });

  it("resolves a relative settings extension from the agent folder", () => {
    const l = layout({ extensions: ["ext/a.js", "../work/b.js"] });

    expect(callRefusal(l, ["ext/a.js", "../work/b.js"], sandbox(l, { writePaths: [join(l.agentDir, "ext")] }))).toBe(
      reason(`ext/a.js (${WRITE_PATH}), ../work/b.js (${WORKTREE})`),
    );
  });

  it("refuses a missing extension path under a write path", () => {
    const l = layout();
    const missing = join(l.root, "nope", "x.js");
    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [missing] }));

    expect(callRefusal(l, [missing], sandbox(l, { writePaths: [join(l.root, "nope")] }))).toBe(
      reason(`${missing} (${WRITE_PATH})`),
    );
  });

  it("applies the local-source rule to a package source", () => {
    const l = layout({ packages: ["./pkg", { source: "/abs/nowhere" }] });
    const part = sandbox(l, { writePaths: [join(l.agentDir, "pkg")] });

    expect(callRefusal(l, ["./pkg", "/abs/nowhere"], part)).toBe(reason(`./pkg (${WRITE_PATH})`));
  });

  it("uses the agent folder for a remote package source", () => {
    const l = layout({ packages: ["npm:pkg", "git:github.com/u/r", "https://user:secret@example.com/pkg"] });
    const trusted = ["npm:pkg", "git:github.com/u/r", "https://user:secret@example.com/pkg"];

    expect(callRefusal(l, trusted, sandbox(l))).toBeUndefined();
    expect(callRefusal(l, trusted, sandbox(l, { writePaths: [l.root] }))).toBe(
      reason(
        `npm:pkg (${WRITE_PATH}), git:github.com/u/r (${WRITE_PATH}), https://***@example.com/pkg (${WRITE_PATH})`,
      ),
    );
  });

  it("masks the URL user in a refusal reason", () => {
    const key = "https://user:secret@example.com/pkg";
    const l = layout({ packages: [key] });

    expect(callRefusal(l, [key], sandbox(l, { writePaths: [l.root] }))).toBe(
      reason(`https://***@example.com/pkg (${WRITE_PATH})`),
    );
  });

  it("does not check a built-in entry", () => {
    const l = layout({ extensions: ["builtin:mcp"] });
    const part = sandbox(l, { writePaths: [l.root] });

    expect(callRefusal(l, ["builtin:mcp"], part)).toBeUndefined();
  });

  it("ignores an untrusted key", () => {
    const l = layout({ extensions: [join("/", "tmp", "nobody")] });

    expect(callRefusal(l, [], sandbox(l, { writePaths: [l.root] }))).toBeUndefined();
  });

  it("lists every matching kind once in a fixed order, in one pair of parentheses", () => {
    const key = "ext/a.js";
    const l = layout({ extensions: [key] });
    const shared = join(l.agentDir, "ext");
    const part = sandbox(l, { worktree: shared, writePaths: [shared], tempFolder: shared });

    expect(callRefusal(l, [key], part)).toBe(reason(`${key} (${WORKTREE}, ${WRITE_PATH}, ${TEMP})`));
  });

  it("follows a link from the extension path into the worktree", () => {
    const l = layout();
    mkdirSync(join(l.agentDir, "extensions"));
    const link = join(l.agentDir, "extensions", "link.js");
    symlinkSync(join(l.worktree, "real.js"), link);
    writeFileSync(join(l.worktree, "real.js"), "");

    expect(callRefusal(l, [link], sandbox(l))).toBe(reason(`${link} (${WORKTREE})`));
  });

  it("refuses a dangling link with a masked real path reason", () => {
    const l = layout();
    mkdirSync(join(l.agentDir, "extensions"));
    const link = join(l.agentDir, "extensions", "dangling.js");
    symlinkSync(join(l.root, "gone"), link);

    expect(callRefusal(l, [link], sandbox(l))).toBe(`tasker cannot find the real path of ${link}: ENOENT`);
  });

  it("masks the URL user in a real path failure", () => {
    const key = "foo://user:secret@example.com/x";
    const l = layout({ packages: [key] });
    symlinkSync(join(l.root, "gone"), join(l.agentDir, "foo:"));

    expect(callRefusal(l, [key], sandbox(l))).toBe(
      "tasker cannot find the real path of foo://***@example.com/x: ENOENT",
    );
  });

  it("refuses a local package folder that contains an allowed write path", () => {
    const l = layout({ packages: ["./pkg"] });
    mkdirSync(join(l.agentDir, "pkg", "sub"), { recursive: true });
    const part = sandbox(l, { writePaths: [join(l.agentDir, "pkg", "sub")] });

    expect(callRefusal(l, ["./pkg"], part)).toBe(reason(`./pkg (${WRITE_PATH})`));
  });

  it("refuses a folder source that contains the temp folder", () => {
    const l = layout();
    const holder = join(l.root, "holder");
    mkdirSync(join(holder, "start"), { recursive: true });

    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [holder] }));
    expect(callRefusal(l, [holder], sandbox(l, { tempFolder: join(holder, "start") }))).toBe(
      reason(`${holder} (${TEMP})`),
    );
  });

  it("refuses an extension path that contains the worktree", () => {
    const l = layout();
    const holder = join(l.root, "holder");
    mkdirSync(join(holder, "work"), { recursive: true });
    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [holder] }));

    expect(callRefusal(l, [holder], sandbox(l, { worktree: join(holder, "work") }))).toBe(
      reason(`${holder} (${WORKTREE})`),
    );
  });

  it("passes an adjacent path that only shares a name prefix", () => {
    const l = layout();
    const adjacent = join(l.root, "pkg2");
    mkdirSync(join(l.root, "pkg"));
    mkdirSync(adjacent);
    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [join(l.root, "pkg")] }));

    expect(callRefusal(l, [join(l.root, "pkg")], sandbox(l, { writePaths: [adjacent] }))).toBeUndefined();
  });

  it("refuses a link whose real folder contains an allowed write path", () => {
    const l = layout();
    mkdirSync(join(l.root, "real", "sub"), { recursive: true });
    const link = join(l.agentDir, "link");
    symlinkSync(join(l.root, "real"), link);
    writeFileSync(join(l.agentDir, "settings.json"), JSON.stringify({ extensions: [link] }));

    expect(callRefusal(l, [link], sandbox(l, { writePaths: [join(l.root, "real", "sub")] }))).toBe(
      reason(`${link} (${WRITE_PATH})`),
    );
  });

  it("returns the listing reason when the agent folder is in the worktree", () => {
    const l = layout();

    expect(callRefusal(l, [], sandbox(l, { worktree: l.root }))).toBe(
      `the agent folder of pi is in the worktree: ${l.agentDir}`,
    );
  });
});
