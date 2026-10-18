import { mkdirSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  changedPaths,
  fetchBaseContainment,
  fetchOnBase,
  fetchOrigin,
  hasCommitsNotIn,
  isAncestor,
  mergeBase,
  NO_OWN_COMMITS,
  ownCommitsText,
  remoteTaskBranchSides,
  remoteTaskBranchState,
  uncommittedChanges,
  uncommittedRefusal,
  worktreeDiff,
} from "../../../src/vcs/git/changes.js";
import { provisionClone } from "../../../src/vcs/git/provision.js";
import { repoPaths } from "../../../src/vcs/git/repo-paths.js";
import { GitError, runGit } from "../../../src/vcs/git/run.js";
import { createTaskWorktree, removeTaskWorktree, taskBranchName } from "../../../src/vcs/git/worktree.js";
import { failureOf } from "../../helpers/errors.js";
import { readArgLog } from "../../helpers/fake-commands.js";
import { fakeSsh } from "../../helpers/fake-ssh.js";
import {
  addCloneCommit,
  amendWorktreeMessage,
  commitInWorktree,
  copyCloneBranchToOrigin,
  gitOutput,
  gitRecorderEnv,
  landBranchOnOriginMain,
  makeGitClone,
  makeGitOrigin,
  sshKeyArgs,
  taskNames,
  type GitOrigin,
} from "../../helpers/git.js";

const MISSING_BRANCH = taskBranchName("issue-99", "");

describe("git changes", () => {
  let origin: GitOrigin;
  let env: NodeJS.ProcessEnv;
  let clone: string;
  let path: string;

  const BASE = "refs/remotes/origin/main";
  let branch: string;

  beforeEach(async () => {
    origin = await makeGitOrigin();
    env = origin.env;
    clone = await makeGitClone(origin);
    ({ branch, worktree: path } = taskNames(join(origin.dir, "worktrees"), 15));
    await createTaskWorktree({ clone, env, path, branch, baseRevision: BASE });
  });

  afterEach(() => {
    origin.remove();
  });

  // Runs git in the worktree and gives the trimmed output.
  const git = (...args: string[]) => gitOutput({ cwd: path }, env, ...args);
  const diff = (extra: Partial<Parameters<typeof worktreeDiff>[0]> = {}) =>
    worktreeDiff({ clone, env, path, baseRevision: BASE, ...extra });
  const paths = (extra: Partial<Parameters<typeof changedPaths>[0]> = {}) =>
    changedPaths({ clone, env, branch, baseRevision: BASE, ...extra });
  const ownCommits = (extra: Partial<Parameters<typeof ownCommitsText>[0]> = {}) =>
    ownCommitsText({ clone, env, branch, baseRevision: BASE, ...extra });
  const changes = (extra: Partial<Parameters<typeof uncommittedChanges>[0]> = {}) =>
    uncommittedChanges({ clone, env, path, ...extra });
  const containment = (extra: Partial<Parameters<typeof fetchBaseContainment>[0]> = {}) =>
    fetchBaseContainment({ clone, env, sshKey: undefined, branch, baseRevision: BASE, ...extra });
  const onBase = (extra: Partial<Parameters<typeof fetchOnBase>[0]> = {}) =>
    fetchOnBase({ clone, env, sshKey: undefined, branch, baseRevision: BASE, ...extra });
  // The tip of the base in the clone.
  const baseTip = () => gitOutput({ gitDir: clone }, env, "rev-parse", BASE);
  // The tip of the task branch in the clone.
  const branchTip = () => gitOutput({ gitDir: clone }, env, "rev-parse", `refs/heads/${branch}`);
  // Adds a commit to the base on origin and fetches it into the clone.
  const moveBase = async () => {
    await origin.addCommit("main", { file: "base-only.txt" });
    await runGit(["fetch", "origin"], { gitDir: clone, env });
  };

  // Writes a fake gpg into dir. It logs each call to <dir>/gpg.log. A sign call (-bsau) reads
  // stdin, prints a fake signature and the SIG_CREATED status line. A --verify call prints
  // GPG_MARKER. It gives the path of the program and of the log.
  const GPG_MARKER = "FAKE GPG VERIFY";
  const writeFakeGpg = (dir: string) => {
    mkdirSync(dir, { recursive: true });
    const program = join(dir, "gpg");
    const logPath = join(dir, "gpg.log");
    writeFileSync(
      program,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$*" >> '${logPath}'`,
        'case " $* " in',
        '  *" -bsau "*)',
        "    cat > /dev/null",
        "    printf '\\n[GNUPG:] SIG_CREATED D 1 8 00 0 0\\n' >&2",
        "    printf '%s\\n' '-----BEGIN PGP SIGNATURE-----' 'fake' '-----END PGP SIGNATURE-----'",
        "    ;;",
        '  *" --verify "*)',
        `    echo '${GPG_MARKER}'`,
        `    echo '${GPG_MARKER}' >&2`,
        "    ;;",
        "esac",
        "exit 0",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    return { program, logPath };
  };

  describe("worktreeDiff", () => {
    it("shows a commit of the branch", async () => {
      await commitInWorktree(path, env, { file: "feature.txt", content: "feature text" });
      const text = await diff();
      expect(text).toContain("feature.txt");
      expect(text).toContain("+feature text");
    });

    it("does not show a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await diff()).not.toContain("base-only.txt");
    });

    it("does not show an uncommitted change", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      writeFileSync(join(path, "README.md"), "changed\n");
      expect(await git("status", "--porcelain")).toBe("M README.md");
      expect(await diff()).not.toContain("README.md");
    });

    it("refuses a base that is not a full revision or a ref", async () => {
      const error = await failureOf(diff({ baseRevision: "main" }), Error);
      expect(error.message).toBe('not a full revision or ref: "main"');
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(diff({ path: plain }), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${plain}`);
    });
  });

  describe("changedPaths", () => {
    it.each(["with space.txt", 'quo"te.txt', "new\nline.txt", "tab\tt.txt", "é.txt", "-dash.txt"])(
      "gives the raw path %j",
      async (file) => {
        await commitInWorktree(path, env, { file });
        expect(await paths()).toEqual([file]);
      },
    );

    it("lists a deleted file", async () => {
      await git("rm", "README.md");
      await git("commit", "-m", "remove README.md");
      expect(await paths()).toEqual(["README.md"]);
    });

    it("lists a binary file", async () => {
      await commitInWorktree(path, env, { file: "data.bin", content: "a\0b" });
      expect(await paths()).toEqual(["data.bin"]);
    });

    it("lists the old and the new path of a rename", async () => {
      await git("mv", "README.md", "moved.md");
      await git("commit", "-m", "rename README.md");
      expect((await paths()).sort()).toEqual(["README.md", "moved.md"]);
    });

    it("does not list a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await paths()).toEqual(["feature.txt"]);
    });

    it("gives an empty list for a fresh branch", async () => {
      expect(await paths()).toEqual([]);
    });

    it("works after the worktree is removed", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await removeTaskWorktree({ clone, env, path });
      expect(await paths()).toEqual(["feature.txt"]);
    });

    it("refuses a missing task branch", async () => {
      const error = await failureOf(paths({ branch: MISSING_BRANCH }), Error);
      expect(error.message).toBe(`cannot resolve the task branch: ${MISSING_BRANCH}`);
    });
  });

  describe("ownCommitsText", () => {
    it("gives the no commits text for a fresh branch", async () => {
      expect(await ownCommits()).toBe(NO_OWN_COMMITS);
      expect(NO_OWN_COMMITS).toBe("This branch has no commits of its own since its base yet.");
    });

    it("gives the commits oldest first, each with its diff", async () => {
      const first = await commitInWorktree(path, env, {
        file: "one.txt",
        content: "one text",
        message: "first",
      });
      const second = await commitInWorktree(path, env, {
        file: "two.txt",
        content: "two text",
        message: "second",
      });
      const text = await ownCommits();
      const at = (needle: string) => text.indexOf(needle);
      expect(at(`commit ${first}`)).toBeGreaterThanOrEqual(0);
      expect(at(`commit ${first}`)).toBeLessThan(at("+one text"));
      expect(at("+one text")).toBeLessThan(at(`commit ${second}`));
      expect(at(`commit ${second}`)).toBeLessThan(at("+two text"));
    });

    it("does not show a file that the base got after the fork", async () => {
      await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await ownCommits()).not.toContain("base-only.txt");
    });

    it("starts no gpg and shows no signature when the configuration asks for one", async () => {
      const gpg = writeFakeGpg(join(origin.dir, "gpg"));
      // Git writes the signature to a temp file before it starts gpg. It uses TMPDIR for it.
      env.TMPDIR = origin.dir;
      await runGit(["config", "gpg.program", gpg.program], { gitDir: clone, env });
      await runGit(["config", "log.showSignature", "true"], { gitDir: clone, env });
      writeFileSync(join(path, "signed.txt"), "signed text\n");
      await git("add", "-A");
      await git("commit", "-S", "-m", "signed");
      expect(readFileSync(gpg.logPath, "utf8")).toContain("-bsau");
      const text = await ownCommits();
      expect(text).toContain("+signed text");
      expect(text).not.toContain(GPG_MARKER);
      expect(readFileSync(gpg.logPath, "utf8")).not.toContain("--verify");
    });
  });

  describe("hasCommitsNotIn", () => {
    const has = (head: string, others: readonly string[]) => hasCommitsNotIn({ clone, env, head, others });

    it("is true for a branch commit that the base does not reach", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await has(sha, [BASE])).toBe(true);
    });

    it("is false when another revision reaches the head", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await has(sha, [BASE, sha])).toBe(false);
    });

    it("is false for a fresh branch", async () => {
      expect(await has(`refs/heads/${branch}`, [BASE])).toBe(false);
    });

    it("is true for each existing head when others is empty", async () => {
      expect(await has(BASE, [])).toBe(true);
    });

    it("refuses a head that is not a full revision or a ref", async () => {
      const error = await failureOf(has("main", [BASE]), Error);
      expect(error.message).toBe('not a full revision or ref: "main"');
    });
  });

  describe("uncommittedChanges", () => {
    it("gives an empty list for a clean worktree", async () => {
      expect(await changes()).toEqual([]);
    });

    it("does not write the index of the worktree", async () => {
      const indexPath = resolve(path, await git("rev-parse", "--git-path", "index"));
      const later = new Date(Date.now() + 60_000);
      utimesSync(join(path, "README.md"), later, later);
      const before = readFileSync(indexPath);
      await changes();
      expect(readFileSync(indexPath).equals(before)).toBe(true);
    });

    it("lists a changed file and a new file", async () => {
      writeFileSync(join(path, "README.md"), "changed\n");
      writeFileSync(join(path, "new.txt"), "new\n");
      expect(await changes()).toEqual([
        { status: " M", path: "README.md" },
        { status: "??", path: "new.txt" },
      ]);
    });

    it("lists a new file when the configuration hides untracked files", async () => {
      await git("config", "status.showUntrackedFiles", "no");
      writeFileSync(join(path, "new.txt"), "new\n");
      expect(await changes()).toEqual([{ status: "??", path: "new.txt" }]);
    });

    it.each(["with space.txt", 'quo"te.txt', "new\nline.txt", "tab\tt.txt", "é.txt", "-dash.txt"])(
      "gives the raw path %j",
      async (file) => {
        writeFileSync(join(path, file), "text\n");
        expect(await changes()).toEqual([{ status: "??", path: file }]);
      },
    );

    it("gives two records for a staged rename", async () => {
      await git("mv", "README.md", "moved.md");
      expect(await changes()).toEqual([
        { status: "D ", path: "README.md" },
        { status: "A ", path: "moved.md" },
      ]);
    });

    it("refuses a folder that is not a worktree of the clone", async () => {
      const plain = join(origin.dir, "plain");
      mkdirSync(plain);
      const error = await failureOf(changes({ path: plain }), Error);
      expect(error.message).toBe(`not a worktree of the clone: ${plain}`);
    });
  });

  describe("remoteTaskBranchState", () => {
    const state = async (extra: Partial<Parameters<typeof remoteTaskBranchState>[0]> = {}) =>
      remoteTaskBranchState({ clone, env, branch, local: await branchTip(), ...extra });
    const copyBranch = () => copyCloneBranchToOrigin({ origin: origin.path, clone, branch, env });
    const fetchAll = (...args: string[]) => runGit(["fetch", ...args, "origin"], { gitDir: clone, env });

    it("is absent when origin has no such branch", async () => {
      await fetchAll();
      expect(await state()).toEqual({ state: "absent" });
    });

    it("is equal when the two tips are the same commit", async () => {
      await copyBranch();
      await fetchAll();
      expect(await state()).toEqual({ state: "present", revision: await branchTip(), relation: "equal" });
    });

    it("says that the local tip is an ancestor of the remote tip", async () => {
      await copyBranch();
      const remote = await origin.addCommit(branch);
      await fetchAll();
      expect(await state()).toEqual({ state: "present", revision: remote, relation: "local-ancestor" });
    });

    it("says that the remote tip is an ancestor of the local tip", async () => {
      await copyBranch();
      const remote = await origin.branchHead(branch);
      await fetchAll();
      await commitInWorktree(path, env, { file: "work.txt" });
      expect(await state()).toEqual({ state: "present", revision: remote, relation: "remote-ancestor" });
    });

    it("says that the tips have diverged", async () => {
      await copyBranch();
      const remote = await origin.addCommit(branch);
      await fetchAll();
      await commitInWorktree(path, env, { file: "work.txt" });
      expect(await state()).toEqual({ state: "present", revision: remote, relation: "diverged" });
    });

    it("is absent after origin deleted the branch and the fetch pruned the ref", async () => {
      await copyBranch();
      await fetchAll();
      await runGit(["branch", "-D", branch], { gitDir: origin.path, env });
      await fetchAll("--prune");
      expect(await state()).toEqual({ state: "absent" });
    });

    it("reads only the ref of origin, not a tag or a local branch with a similar name", async () => {
      await copyBranch();
      await fetchAll();
      const base = await baseTip();
      await runGit(["tag", `origin/${branch}`, base], { gitDir: clone, env });
      await runGit(["branch", `origin/${branch}`, base], { gitDir: clone, env });
      expect(await state()).toEqual({ state: "present", revision: await branchTip(), relation: "equal" });
    });

    it("stays absent when only a tag or a local branch has the similar name", async () => {
      await fetchAll();
      const base = await baseTip();
      await runGit(["tag", `origin/${branch}`, base], { gitDir: clone, env });
      await runGit(["branch", `origin/${branch}`, base], { gitDir: clone, env });
      expect(await state()).toEqual({ state: "absent" });
    });

    it("rejects a bad branch name before any git call", async () => {
      const recorded = gitRecorderEnv(origin.dir, env);
      const error = await failureOf(state({ branch: "-x", env: recorded.env }), Error);
      expect(error.message).toBe('not a task branch name: "-x"');
      expect(readArgLog(recorded.log)).toEqual([]);
    });

    it("rejects a local tip that is not a full revision before any git call", async () => {
      const recorded = gitRecorderEnv(origin.dir, env);
      const error = await failureOf(state({ local: "HEAD", env: recorded.env }), Error);
      expect(error.message).toBe('the local tip is not a full revision: "HEAD"');
      expect(readArgLog(recorded.log)).toEqual([]);
    });

    it("uses the passed local tip and does not read the task branch", async () => {
      await copyBranch();
      const remote = await origin.branchHead(branch);
      await fetchAll();
      await commitInWorktree(path, env, { file: "work.txt" });
      expect(await state({ local: remote })).toEqual({ state: "present", revision: remote, relation: "equal" });
    });
  });

  describe("remoteTaskBranchSides", () => {
    const remoteTip = () => gitOutput({ gitDir: clone }, env, "rev-parse", `refs/remotes/origin/${branch}`);
    const sides = async (extra: Partial<Parameters<typeof remoteTaskBranchSides>[0]> = {}) =>
      remoteTaskBranchSides({
        clone,
        env,
        branch,
        local: await branchTip(),
        remote: await remoteTip(),
        baseTip: await baseTip(),
        ...extra,
      });
    const copyBranch = () => copyCloneBranchToOrigin({ origin: origin.path, clone, branch, env });
    const fetchAll = () => runGit(["fetch", "origin"], { gitDir: clone, env });

    it("counts a commit that differs only in its message as the same patch", async () => {
      await commitInWorktree(path, env, { file: "work.txt", message: "old message" });
      const before = await branchTip();
      await copyBranch();
      await fetchAll();
      const after = await amendWorktreeMessage(path, env, "new message");
      expect(await sides()).toEqual({
        local: [{ revision: after, subject: "new message", merge: false, samePatch: true, onBase: false }],
        remote: [{ revision: before, subject: "old message", merge: false, samePatch: true }],
      });
    });

    it("lists a commit that has no copy on the other side", async () => {
      await copyBranch();
      const remote = await origin.addCommit(branch, { file: "remote.txt", message: "remote work" });
      await fetchAll();
      const local = await commitInWorktree(path, env, { file: "local.txt", message: "local work" });
      expect(await sides()).toEqual({
        local: [{ revision: local, subject: "local work", merge: false, samePatch: false, onBase: false }],
        remote: [{ revision: remote, subject: "remote work", merge: false, samePatch: false }],
      });
    });

    it("marks a merge commit on the remote side", async () => {
      await copyBranch();
      await origin.addCommit("main", { file: "main-only.txt" });
      const merge = await origin.addMerge(branch);
      await fetchAll();
      await commitInWorktree(path, env, { file: "local.txt" });
      const result = await sides();
      expect(result.remote.map((c) => c.merge)).toEqual([false, true]);
      expect(result.remote.at(-1)).toMatchObject({ revision: merge, merge: true, samePatch: false });
    });

    it("marks a local commit that the base tip reaches, and a local merge of the base", async () => {
      await copyBranch();
      await origin.addCommit(branch, { file: "remote.txt" });
      const main = await origin.addCommit("main", { file: "main-only.txt" });
      await fetchAll();
      await runGit(["merge", "--no-edit", "refs/remotes/origin/main"], { cwd: path, env });
      const merge = await branchTip();
      const result = await sides({ baseTip: main });
      expect(result.local).toMatchObject([
        { revision: main, merge: false, samePatch: false, onBase: true },
        { revision: merge, merge: true, samePatch: false, onBase: false },
      ]);
    });

    it("gives a non-ASCII subject as UTF-8 when the clone re-encodes the log output", async () => {
      await runGit(["config", "i18n.logOutputEncoding", "ISO-8859-1"], { gitDir: clone, env });
      await copyBranch();
      await origin.addCommit(branch, { file: "remote.txt" });
      await fetchAll();
      await commitInWorktree(path, env, { file: "local.txt", message: "Ünïcode" });
      const result = await sides();
      expect(result.local.map((c) => c.subject)).toEqual(["Ünïcode"]);
    });

    it("rejects a bad branch name before any git call", async () => {
      const recorded = gitRecorderEnv(origin.dir, env);
      const error = await failureOf(sides({ branch: "-x", env: recorded.env }), Error);
      expect(error.message).toBe('not a task branch name: "-x"');
      expect(readArgLog(recorded.log)).toEqual([]);
    });

    it.each(["local", "remote", "baseTip"] as const)(
      "rejects a %s that is not a full revision before any git call",
      async (name) => {
        await copyBranch();
        await fetchAll();
        const recorded = gitRecorderEnv(origin.dir, env);
        await failureOf(sides({ [name]: "HEAD", env: recorded.env }), Error);
        expect(readArgLog(recorded.log)).toEqual([]);
      },
    );
  });

  describe("isAncestor", () => {
    const ancestor = (a: string, d: string) => isAncestor({ clone, env, ancestor: a, descendant: d });

    it("is true for the base and a branch commit", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await ancestor(BASE, sha)).toBe(true);
    });

    it("is true for the same commit", async () => {
      expect(await ancestor(BASE, BASE)).toBe(true);
    });

    it("is false the other way", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await ancestor(sha, BASE)).toBe(false);
    });

    it("passes on the failure of git for a commit that the clone does not have", async () => {
      const error = await failureOf(ancestor("1".repeat(40), BASE), GitError);
      expect(error.subcommand).toBe("merge-base");
      expect(error.exitCode).toBe(128);
    });

    it("refuses a missing ref", async () => {
      const error = await failureOf(ancestor("refs/heads/missing", BASE), Error);
      expect(error.message).toBe("cannot resolve the revision: refs/heads/missing");
    });
  });

  describe("mergeBase", () => {
    const base = (a: string, b: string) => mergeBase({ clone, env, a, b });
    // Runs plain git merge-base in the clone, as a separate read of the same answer.
    const plain = (a: string, b: string) => gitOutput({ gitDir: clone }, env, "merge-base", a, b);

    it("gives the fork commit of a branch and its moved base", async () => {
      const fork = await baseTip();
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await base(sha, BASE)).toBe(fork);
      expect(await base(sha, BASE)).toBe(await plain(sha, BASE));
    });

    it("gives the same commit for the two inputs in either order", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      await moveBase();
      expect(await base(BASE, sha)).toBe(await base(sha, BASE));
    });

    it("gives the older commit when one input holds the other", async () => {
      const sha = await commitInWorktree(path, env, { file: "feature.txt" });
      expect(await base(sha, BASE)).toBe(await baseTip());
    });

    it("refuses a missing ref", async () => {
      const error = await failureOf(base("refs/heads/missing", BASE), Error);
      expect(error.message).toBe("cannot resolve the revision: refs/heads/missing");
    });
  });

  describe("fetchOrigin", () => {
    it("moves the base ref and leaves the worktree as it is", async () => {
      const head = await git("rev-parse", "HEAD");
      const status = await git("status", "--porcelain");
      const tip = await origin.addCommit("main");
      await fetchOrigin({ clone, env, sshKey: undefined });
      expect(await baseTip()).toBe(tip);
      expect(tip).toBe(await origin.branchHead("main"));
      expect(await git("rev-parse", "HEAD")).toBe(head);
      expect(await git("status", "--porcelain")).toBe(status);
    });

    it("fetches with the ssh key of the repo", async () => {
      const ssh = fakeSsh(origin.dir, env, "serve");
      const { clone: sshClone, publishTokens } = repoPaths(join(origin.dir, "ssh-clone"), "tasker");
      await provisionClone({
        remote: ssh.remote(origin.path),
        clone: sshClone,
        config: {},
        env: ssh.env,
        publishTokens,
      });
      rmSync(ssh.logPath, { force: true });
      const key = join(origin.dir, "id key");

      await fetchOrigin({ clone: sshClone, env: ssh.env, sshKey: key });

      const calls = readArgLog(ssh.logPath);
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.slice(0, 6)).toEqual(sshKeyArgs(key));
      }
    });
  });

  describe("fetchBaseContainment", () => {
    it("says that a worktree with a commit on top of the base contains its tip", async () => {
      const head = await commitInWorktree(path, env, { file: "work.txt" });
      expect(await containment()).toEqual({ revision: head, baseTip: await baseTip(), contains: true });
    });

    it("says that the worktree does not contain a base that moved on origin", async () => {
      const head = await commitInWorktree(path, env, { file: "work.txt" });
      const tip = await origin.addCommit("main");
      expect(await containment()).toEqual({ revision: head, baseTip: tip, contains: false });
      expect(await baseTip()).toBe(tip);
    });

    it("reads a local base and does not move it", async () => {
      await runGit(["update-ref", "refs/heads/x", BASE], { gitDir: clone, env });
      const head = await branchTip();
      expect(await containment({ baseRevision: "refs/heads/x" })).toEqual({
        revision: head,
        baseTip: head,
        contains: true,
      });
      const tip = await addCloneCommit(clone, env, "x");
      expect(await containment({ baseRevision: "refs/heads/x" })).toEqual({
        revision: head,
        baseTip: tip,
        contains: false,
      });
    });

    it("reads the tip of the task branch, not a detached head of the worktree", async () => {
      await git("switch", "--detach");
      const detached = await commitInWorktree(path, env, { file: "detached.txt" });
      const result = await containment();
      expect(result).toEqual({ revision: await branchTip(), baseTip: await baseTip(), contains: true });
      expect(result.revision).not.toBe(detached);
    });

    it("rejects a bad branch name before the fetch", async () => {
      const before = await baseTip();
      await origin.addCommit("main");
      const error = await failureOf(containment({ branch: "HEAD" }), Error);
      expect(error.message).toBe('not a task branch name: "HEAD"');
      expect(await baseTip()).toBe(before);
    });

    it("rejects for a base that origin does not have", async () => {
      const error = await failureOf(containment({ baseRevision: "refs/remotes/origin/gone" }), Error);
      expect(error.message).toBe("cannot resolve the revision: refs/remotes/origin/gone");
    });

    it("rejects with the error of git when the fetch fails and keeps the base tip", async () => {
      const before = await baseTip();
      renameSync(origin.path, `${origin.path}-moved`);
      const error = await failureOf(containment(), GitError);
      expect(error.subcommand).toBe("fetch");
      expect(await baseTip()).toBe(before);
    });
  });

  describe("fetchOnBase", () => {
    it("says that the base on origin does not contain a commit on top of it", async () => {
      const head = await commitInWorktree(path, env, { file: "work.txt" });
      expect(await onBase()).toEqual({ revision: head, baseTip: await baseTip(), onBase: false });
    });

    it("says that the base contains a branch with no own commit", async () => {
      const tip = await baseTip();
      expect(await onBase()).toEqual({ revision: tip, baseTip: tip, onBase: true });
    });

    it("says that the base contains the branch after origin took its head, and fetches it", async () => {
      const head = await commitInWorktree(path, env, { file: "work.txt" });
      await landBranchOnOriginMain({ origin: origin.path, clone, branch, env });
      expect(await onBase()).toEqual({ revision: head, baseTip: head, onBase: true });
      expect(await baseTip()).toBe(head);
    });

    it("rejects a bad branch name before the fetch", async () => {
      const before = await baseTip();
      await origin.addCommit("main");
      const error = await failureOf(onBase({ branch: "HEAD" }), Error);
      expect(error.message).toBe('not a task branch name: "HEAD"');
      expect(await baseTip()).toBe(before);
    });

    it("rejects with the error of git when the fetch fails and keeps the base tip", async () => {
      const before = await baseTip();
      renameSync(origin.path, `${origin.path}-moved`);
      const error = await failureOf(onBase(), GitError);
      expect(error.subcommand).toBe("fetch");
      expect(await baseTip()).toBe(before);
    });
  });
});

describe("uncommittedRefusal", () => {
  it("names each path as JSON text", () => {
    const text = uncommittedRefusal("/w", [
      { status: " M", path: "README.md" },
      { status: "??", path: "a, b\n.txt" },
    ]);
    expect(text).toBe(
      `the worktree has uncommitted changes: /w: ${JSON.stringify("README.md")}, ${JSON.stringify("a, b\n.txt")}`,
    );
  });
});
