import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { materializeProtectedWorkspaceChanges } from "../../../src/vcs/git/protected-skills.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { createGitProvider } from "../../../src/vcs/git/provider.js";
import { commitIndexChanges, gitOutput, makeProviderFixture, type ProviderFixture } from "../../helpers/git.js";

describe("materializeProtectedWorkspaceChanges", () => {
  let fixture: ProviderFixture;

  beforeEach(async () => {
    fixture = await makeProviderFixture();
    await fixture.origin.addCommit("main", {
      file: ".agents/skills/edit.md",
      content: "before edit\n",
    });
    await fixture.origin.addCommit("main", {
      file: ".agents/skills/move.md",
      content: "move me\n",
    });
    await fixture.origin.addCommit("main", {
      file: ".agents/skills/delete.md",
      content: "delete me\n",
    });
  });

  afterEach(() => {
    fixture.remove();
  });

  const paths = () => repoPaths(fixture.context.dataRoot, fixture.context.repoKey);
  const provider = () => createGitProvider({ remote: fixture.origin.path, config: {} });
  const workspace = async (shortRef = "issue-790") => {
    const git = provider();
    await git.provision(fixture.context);
    return git.createWorkspace(fixture.context, {
      shortRef,
      title: "Protected skills",
      baseRevision: "refs/remotes/origin/main",
    });
  };
  const options = (
    work: { path: string; taskRef: string },
    revisions: { beforeRevision: string; afterRevision: string },
    deniedPaths: string[] = [],
  ) => ({
    clone: paths().clone,
    env: fixture.context.env,
    path: work.path,
    taskRef: work.taskRef,
    ...revisions,
    deniedPaths,
  });

  it("materializes canonical add, edit, move, delete, and the exact Codex link", async () => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/add.md", content: "added\n" },
      { path: ".agents/skills/edit.md", content: "after edit\n" },
      { path: ".agents/skills/move.md", content: null },
      { path: ".agents/skills/moved.md", content: "move me\n" },
      { path: ".agents/skills/delete.md", content: null },
      { path: ".codex/skills", content: "../.agents/skills", mode: "120000" },
    ]);

    await materializeProtectedWorkspaceChanges(options(work, revisions));

    expect(readFileSync(join(work.path, ".agents/skills/add.md"), "utf8")).toBe("added\n");
    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe("after edit\n");
    expect(existsSync(join(work.path, ".agents/skills/move.md"))).toBe(false);
    expect(readFileSync(join(work.path, ".agents/skills/moved.md"), "utf8")).toBe("move me\n");
    const materializedSkillStat = statSync(join(work.path, ".agents/skills/add.md"));
    expect(materializedSkillStat.isFile()).toBe(true);
    expect(materializedSkillStat.mode & 0o111).toBe(0);
    expect(existsSync(join(work.path, ".agents/skills/delete.md"))).toBe(false);
    expect(readlinkSync(join(work.path, ".codex/skills"))).toBe("../.agents/skills");
    expect(await gitOutput({ cwd: work.path }, fixture.context.env, "status", "--porcelain")).toBe("");
  });

  it("leaves tracked legacy Claude files alone when the request does not change them", async () => {
    await fixture.origin.addCommit("main", {
      file: ".claude/skills/session-review/SKILL.md",
      content: "legacy skill\n",
    });
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/edit.md", content: "after edit\n" },
    ]);

    await materializeProtectedWorkspaceChanges(options(work, revisions));

    expect(readFileSync(join(work.path, ".claude/skills/session-review/SKILL.md"), "utf8")).toBe("legacy skill\n");
    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe("after edit\n");
    expect(await gitOutput({ cwd: work.path }, fixture.context.env, "status", "--porcelain")).toBe("");
  });

  it("refuses a tracked legacy Claude file without a matching canonical move", async () => {
    await fixture.origin.addCommit("main", {
      file: ".claude/skills/session-review/SKILL.md",
      content: "legacy skill\n",
    });
    await fixture.origin.addCommit("main", {
      file: ".claude/skills/unrelated.md",
      content: "unmatched legacy file\n",
    });
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".claude/skills/session-review/SKILL.md", content: null },
      { path: ".claude/skills/unrelated.md", content: null },
      { path: ".agents/skills/session-review/SKILL.md", content: "legacy skill\n" },
      { path: ".claude/skills", content: "../.agents/skills", mode: "120000" },
    ]);
    rmSync(join(work.path, ".claude/skills"), { recursive: true });
    symlinkSync("../.agents/skills", join(work.path, ".claude/skills"));

    await expect(materializeProtectedWorkspaceChanges(options(work, revisions))).rejects.toThrow();

    expect(existsSync(join(work.path, ".agents/skills/session-review/SKILL.md"))).toBe(false);
    expect(readlinkSync(join(work.path, ".claude/skills"))).toBe("../.agents/skills");
  });

  it("refuses invalid UTF-8 blobs before writing any protected destination", async () => {
    const work = await workspace();
    const beforeRevision = await gitOutput({ cwd: work.path }, fixture.context.env, "rev-parse", "HEAD");
    const invalidBytes = Buffer.from([0x66, 0x80, 0x6f]);
    const object = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: work.path,
      env: fixture.context.env,
      input: invalidBytes,
      encoding: "utf8",
    }).trim();
    const editObject = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: work.path,
      env: fixture.context.env,
      input: Buffer.from("partial edit\n"),
      encoding: "utf8",
    }).trim();
    await gitOutput(
      { cwd: work.path },
      fixture.context.env,
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${object},.agents/skills/invalid.md`,
    );
    await gitOutput(
      { cwd: work.path },
      fixture.context.env,
      "update-index",
      "--add",
      "--cacheinfo",
      `100644,${editObject},.agents/skills/edit.md`,
    );
    const tree = await gitOutput({ cwd: work.path }, fixture.context.env, "write-tree");
    const afterRevision = await gitOutput(
      { cwd: work.path },
      fixture.context.env,
      "commit-tree",
      tree,
      "-p",
      beforeRevision,
      "-m",
      "invalid UTF-8 protected request",
    );
    await gitOutput(
      { gitDir: paths().clone },
      fixture.context.env,
      "update-ref",
      `refs/heads/${work.taskRef}`,
      afterRevision,
      beforeRevision,
    );

    await expect(
      materializeProtectedWorkspaceChanges(options(work, { beforeRevision, afterRevision })),
    ).rejects.toThrow();

    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe("before edit\n");
    expect(existsSync(join(work.path, ".agents/skills/invalid.md"))).toBe(false);
  });

  it("materializes valid UTF-8 replacement-character bytes exactly", async () => {
    const work = await workspace();
    const bytes = Buffer.from("valid \uFFFD bytes\n", "utf8");
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/replacement.md", content: bytes.toString("utf8") },
    ]);

    await materializeProtectedWorkspaceChanges(options(work, revisions));

    expect(readFileSync(join(work.path, ".agents/skills/replacement.md"))).toEqual(bytes);
  });

  it("replaces invalid worktree bytes that decode like valid replacement-character bytes", async () => {
    const work = await workspace();
    const expectedBytes = Buffer.from("valid \uFFFD bytes\n", "utf8");
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/replacement.md", content: expectedBytes.toString("utf8") },
    ]);
    const invalidBytes = Buffer.from([
      0x76, 0x61, 0x6c, 0x69, 0x64, 0x20, 0x80, 0x20, 0x62, 0x79, 0x74, 0x65, 0x73, 0x0a,
    ]);
    writeFileSync(join(work.path, ".agents/skills/replacement.md"), invalidBytes);

    await materializeProtectedWorkspaceChanges(options(work, revisions));

    expect(readFileSync(join(work.path, ".agents/skills/replacement.md"))).toEqual(expectedBytes);
    expect(await gitOutput({ cwd: work.path }, fixture.context.env, "status", "--porcelain")).toBe("");
  });

  it("refuses a matching executable canonical file before changing another skill", async () => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/edit.md", content: "after edit\n" },
    ]);
    writeFileSync(join(work.path, ".agents/skills/edit.md"), "after edit\n");
    chmodSync(join(work.path, ".agents/skills/edit.md"), 0o755);

    await expect(materializeProtectedWorkspaceChanges(options(work, revisions))).rejects.toThrow();

    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe("after edit\n");
    expect(statSync(join(work.path, ".agents/skills/edit.md")).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(work.path, ".agents/skills/move.md"), "utf8")).toBe("move me\n");
  });

  it.each([
    ["the old bytes", "before edit\n"],
    ["the ending bytes", "after edit\n"],
  ])("refuses a hard-linked canonical destination with %s before any protected write", async (_label, content) => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/a-write.md", content: "must not be written\n" },
      { path: ".agents/skills/edit.md", content: "after edit\n" },
    ]);
    const destination = join(work.path, ".agents/skills/edit.md");
    const sentinel = join(fixture.origin.dir, "hard-link-sentinel.md");
    writeFileSync(sentinel, content);
    unlinkSync(destination);
    linkSync(sentinel, destination);

    await expect(materializeProtectedWorkspaceChanges(options(work, revisions))).rejects.toThrow();

    expect(readFileSync(sentinel, "utf8")).toBe(content);
    expect(readFileSync(destination, "utf8")).toBe(content);
    expect(statSync(sentinel).nlink).toBe(2);
    expect(statSync(destination).nlink).toBe(2);
    expect(existsSync(join(work.path, ".agents/skills/a-write.md"))).toBe(false);
  });

  it.each([
    ["an .agents sibling", ".agents/other.md", "content\n", "100644"],
    ["another .codex entry", ".codex/settings.json", "{}\n", "100644"],
    ["an .aws entry", ".aws/credentials", "secret\n", "100644"],
    ["a .git entry", ".git/tasker", "content\n", "100644"],
    ["the Claude alias", ".claude/skills/alias.md", "content\n", "100644"],
    ["a symlink inside canonical skills", ".agents/skills/inner-link", "../other\n", "120000"],
    ["an executable canonical file", ".agents/skills/run.sh", "echo no\n", "100755"],
    ["a Codex link with the wrong target", ".codex/skills", "../../outside\n", "120000"],
    ["a Codex link with the wrong mode", ".codex/skills", "../.agents/skills", "100644"],
    ["a Claude link with the wrong target", ".claude/skills", "../../outside\n", "120000"],
    ["a Claude link with the wrong mode", ".claude/skills", "../.agents/skills", "100644"],
  ])("refuses %s without writing any protected destination", async (_label, path, content, mode) => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path, content, mode: mode as "100644" | "100755" | "120000" },
    ]);
    const before = readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8");

    await expect(materializeProtectedWorkspaceChanges(options(work, revisions))).rejects.toThrow();

    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe(before);
    expect(existsSync(join(work.path, ".agents/skills/run.sh"))).toBe(false);
    expect(existsSync(join(work.path, ".codex/skills"))).toBe(false);
  });

  it("refuses an explicitly denied canonical path", async () => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/denied.md", content: "denied\n" },
    ]);

    await expect(
      materializeProtectedWorkspaceChanges(options(work, revisions, [join(work.path, ".agents/skills/denied.md")])),
    ).rejects.toThrow();

    expect(existsSync(join(work.path, ".agents/skills/denied.md"))).toBe(false);
  });

  it("refuses an unrelated destination and a linked protected parent", async () => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/unrelated.md", content: "requested\n" },
    ]);
    mkdirSync(join(work.path, ".agents/skills"), { recursive: true });
    writeFileSync(join(work.path, ".agents/skills/unrelated.md"), "keep me\n");

    await expect(materializeProtectedWorkspaceChanges(options(work, revisions))).rejects.toThrow();
    expect(readFileSync(join(work.path, ".agents/skills/unrelated.md"), "utf8")).toBe("keep me\n");

    const linkedWork = await workspace("issue-791");
    const linkedRevisions = commitIndexChanges(linkedWork.path, linkedWork.taskRef, fixture.context.env, [
      { path: ".agents/skills/new.md", content: "new\n" },
    ]);
    const outside = join(fixture.origin.dir, "linked-skills-target");
    mkdirSync(outside);
    rmSync(join(linkedWork.path, ".agents"), { recursive: true, force: true });
    symlinkSync(outside, join(linkedWork.path, ".agents"));

    await expect(materializeProtectedWorkspaceChanges(options(linkedWork, linkedRevisions))).rejects.toThrow();
    expect(existsSync(join(outside, "skills/new.md"))).toBe(false);
  });

  it("replays a partial materialization only when existing content matches the committed result", async () => {
    const work = await workspace();
    const revisions = commitIndexChanges(work.path, work.taskRef, fixture.context.env, [
      { path: ".agents/skills/partial.md", content: "after\n" },
      { path: ".agents/skills/edit.md", content: "after edit\n" },
    ]);
    mkdirSync(join(work.path, ".agents/skills"), { recursive: true });
    writeFileSync(join(work.path, ".agents/skills/partial.md"), "after\n");

    await materializeProtectedWorkspaceChanges(options(work, revisions));

    expect(readFileSync(join(work.path, ".agents/skills/partial.md"), "utf8")).toBe("after\n");
    expect(readFileSync(join(work.path, ".agents/skills/edit.md"), "utf8")).toBe("after edit\n");
  });
});
