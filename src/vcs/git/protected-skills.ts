import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { errnoCode } from "../../errno.js";
import { isInside } from "../../real-path.js";
import { listWorktrees, assertTaskBranchNameAndShape } from "./worktree.js";
import { runGit } from "./run.js";

const CODEX_LINK = "../.agents/skills";

export interface ProtectedWorkspaceChangeOptions {
  clone: string;
  env: NodeJS.ProcessEnv;
  path: string;
  taskRef: string;
  beforeRevision: string;
  afterRevision: string;
  deniedPaths: readonly string[];
}

interface TreeEntry {
  mode: string;
  type: string;
  object: string;
}

interface MaterializedEntry {
  path: string;
  before: TreeEntry | undefined;
  after: TreeEntry | undefined;
  beforeContent: string | undefined;
  afterContent: string | undefined;
}

function refuse(options: ProtectedWorkspaceChangeOptions, path: string, reason: string): never {
  throw new Error(
    `protected workspace change refused at ${JSON.stringify(path)} (${options.beforeRevision}..${options.afterRevision}): ${reason}`,
  );
}

function isProtectedPath(path: string): boolean {
  return (
    path === ".agents" ||
    path.startsWith(".agents/") ||
    path === ".codex" ||
    path.startsWith(".codex/") ||
    path === ".aws" ||
    path.startsWith(".aws/") ||
    path === ".git" ||
    path.startsWith(".git/") ||
    path === ".claude/skills" ||
    path.startsWith(".claude/skills/")
  );
}

function denied(path: string, worktree: string, deniedPaths: readonly string[]): boolean {
  const absolute = resolve(worktree, path);
  return deniedPaths.some((entry) => {
    const wildcard = entry.endsWith("/**");
    const deniedPath = resolve(worktree, wildcard ? entry.slice(0, -3) : entry);
    return absolute === deniedPath || isInside(absolute, deniedPath);
  });
}

function safeComponents(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !path.includes("\\") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

async function contentOf(
  options: ProtectedWorkspaceChangeOptions,
  entry: TreeEntry | undefined,
  path: string,
): Promise<string | undefined> {
  if (entry === undefined) return undefined;
  if (entry.type !== "blob") refuse(options, path, "the entry is not a file or link blob");
  const content = await runGit(["cat-file", "blob", entry.object], { gitDir: options.clone, env: options.env });
  const algorithm = entry.object.length === 40 ? "sha1" : entry.object.length === 64 ? "sha256" : undefined;
  if (algorithm === undefined) refuse(options, path, "the blob has an unsupported object ID");
  const bytes = Buffer.from(content, "utf8");
  const object = createHash(algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (object !== entry.object) refuse(options, path, "the decoded blob bytes do not match the Git object ID");
  return content;
}

function lstatOrUndefined(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (errnoCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

function refuseHardLinkedCanonicalDestination(
  options: ProtectedWorkspaceChangeOptions,
  path: string,
  target: string,
): void {
  if (!path.startsWith(".agents/skills/")) return;
  const stat = lstatOrUndefined(target);
  if (stat !== undefined && stat.nlink > 1) {
    refuse(options, path, "the canonical skill destination has multiple hard links");
  }
}

function checkParents(options: ProtectedWorkspaceChangeOptions, relativePath: string): string {
  const root = resolve(options.path);
  const rootStat = lstatOrUndefined(root);
  if (rootStat === undefined || !rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    refuse(options, relativePath, "the workspace root is missing, linked, or not a directory");
  }
  let current = root;
  const parts = relativePath.split("/");
  for (const part of parts.slice(0, -1)) {
    current = join(current, part);
    const stat = lstatOrUndefined(current);
    if (stat === undefined) break;
    if (stat.isSymbolicLink()) refuse(options, relativePath, `a parent is a symbolic link: ${current}`);
    if (!stat.isDirectory()) refuse(options, relativePath, `a parent is not a directory: ${current}`);
  }
  return join(root, ...parts);
}

function currentContent(options: ProtectedWorkspaceChangeOptions, path: string): string | Buffer | undefined {
  const target = checkParents(options, path);
  const stat = lstatOrUndefined(target);
  if (stat === undefined) return undefined;
  if (path === ".codex/skills") {
    if (!stat.isSymbolicLink()) refuse(options, path, "the Codex destination is not a symbolic link");
    return readlinkSync(target);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) refuse(options, path, "the destination is not a regular file");
  refuseHardLinkedCanonicalDestination(options, path, target);
  if (path.startsWith(".agents/skills/") && (stat.mode & 0o111) !== 0) {
    refuse(options, path, "the canonical skill file has executable bits");
  }
  return readFileSync(target);
}

function validateSafeEntry(
  options: ProtectedWorkspaceChangeOptions,
  path: string,
  entry: TreeEntry | undefined,
  content: string | undefined,
): void {
  if (entry === undefined) return;
  if (path === ".codex/skills") {
    if (entry.mode !== "120000" || entry.type !== "blob" || content !== CODEX_LINK) {
      refuse(options, path, `the Codex link must have mode 120000 and target ${CODEX_LINK}`);
    }
    return;
  }
  if (!path.startsWith(".agents/skills/") || !safeComponents(path)) {
    refuse(options, path, "only canonical skill files and the exact Codex link are permitted");
  }
  if (entry.mode !== "100644" || entry.type !== "blob") {
    refuse(options, path, "a canonical skill entry must be a regular file with mode 100644");
  }
}

function worktreeContent(path: string, content: string | undefined): string | Buffer | undefined {
  return content === undefined
    ? undefined
    : path.startsWith(".agents/skills/")
      ? Buffer.from(content, "utf8")
      : content;
}

function entryMatches(current: string | Buffer | undefined, expected: string | undefined, path: string): boolean {
  const expectedWorktreeContent = worktreeContent(path, expected);
  if (Buffer.isBuffer(current) || Buffer.isBuffer(expectedWorktreeContent)) {
    return (
      Buffer.isBuffer(current) && Buffer.isBuffer(expectedWorktreeContent) && current.equals(expectedWorktreeContent)
    );
  }
  return current === expectedWorktreeContent;
}

function assertRevision(options: ProtectedWorkspaceChangeOptions, revision: string, label: string): Promise<string> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) {
    return Promise.reject(new Error(`protected workspace change refused: invalid ${label} revision ${revision}`));
  }
  return runGit(["rev-parse", "--verify", `${revision}^{commit}`], { gitDir: options.clone, env: options.env }).then(
    (actual) => {
      if (actual.trim() !== revision) refuse(options, "<revision>", `the ${label} revision is not exact`);
      return actual.trim();
    },
    () => refuse(options, "<revision>", `the ${label} revision is missing`),
  );
}

export async function materializeProtectedWorkspaceChanges(options: ProtectedWorkspaceChangeOptions): Promise<void> {
  assertTaskBranchNameAndShape(options.taskRef);
  const worktree = resolve(options.path);
  if (realpathSync(worktree) !== worktree) refuse(options, worktree, "the workspace path is linked or not canonical");
  const registered = await listWorktrees({ clone: options.clone, env: options.env });
  if (!registered.some((entry) => resolve(entry.path) === worktree && entry.taskRef === options.taskRef)) {
    refuse(options, worktree, "the path is not the registered workspace of this task ref");
  }
  const [beforeRevision, afterRevision] = await Promise.all([
    assertRevision(options, options.beforeRevision, "starting"),
    assertRevision(options, options.afterRevision, "ending"),
  ]);
  const branchTip = (
    await runGit(["rev-parse", "--verify", `refs/heads/${options.taskRef}^{commit}`], {
      gitDir: options.clone,
      env: options.env,
    })
  ).trim();
  if (branchTip !== afterRevision)
    refuse(options, options.taskRef, "the task ref tip changed after the ending revision was recorded");
  const worktreeHead = (
    await runGit(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: worktree, env: options.env })
  ).trim();
  if (worktreeHead !== afterRevision)
    refuse(options, worktree, "the workspace head does not match the ending revision");
  try {
    await runGit(["merge-base", "--is-ancestor", beforeRevision, afterRevision], {
      gitDir: options.clone,
      env: options.env,
    });
  } catch {
    refuse(options, "<revision>", "the ending revision does not descend from the starting revision");
  }

  const [beforeTreeOutput, afterTreeOutput, changedOutput, indexTree] = await Promise.all([
    runGit(["ls-tree", "-r", "-z", "--full-tree", beforeRevision], { gitDir: options.clone, env: options.env }),
    runGit(["ls-tree", "-r", "-z", "--full-tree", afterRevision], { gitDir: options.clone, env: options.env }),
    runGit(["diff", "--no-renames", "--name-only", "-z", beforeRevision, afterRevision], {
      gitDir: options.clone,
      env: options.env,
    }),
    runGit(["write-tree"], { cwd: worktree, env: options.env }),
  ]);
  const expectedTree = (
    await runGit(["rev-parse", "--verify", `${afterRevision}^{tree}`], { gitDir: options.clone, env: options.env })
  ).trim();
  if (indexTree.trim() !== expectedTree) refuse(options, "<index>", "the index does not match the ending tree");
  const beforeTree = readTreeOutput(options, beforeTreeOutput);
  const afterTree = readTreeOutput(options, afterTreeOutput);
  const changedPaths = [...new Set(changedOutput.split("\0").filter((path) => path !== ""))];
  for (const path of changedPaths) {
    if (denied(path, worktree, options.deniedPaths)) refuse(options, path, "the changed path is explicitly denied");
  }
  const legacyPaths = [...beforeTree.keys()].filter((path) => path.startsWith(".claude/skills/"));
  const legacyMovePaths = new Set<string>();
  if (legacyPaths.some((path) => changedPaths.includes(path))) {
    const link = afterTree.get(".claude/skills");
    if (link === undefined || !changedPaths.includes(".claude/skills")) {
      refuse(options, ".claude/skills", "the tracked legacy move needs the exact Claude link in the ending tree");
    }
    const linkContent = await contentOf(options, link, ".claude/skills");
    validateSafeEntry(options, ".claude/skills", link, linkContent);
    if (currentContent(options, ".claude/skills") !== CODEX_LINK) {
      refuse(options, ".claude/skills", "the tracked legacy move needs the exact Claude link in the worktree");
    }
    for (const path of legacyPaths) {
      const before = beforeTree.get(path);
      if (before?.mode !== "100644" || before?.type !== "blob") {
        refuse(options, path, "each tracked legacy Claude file must be a regular file with mode 100644");
      }
      if (afterTree.has(path) || !changedPaths.includes(path)) {
        refuse(options, path, "each tracked legacy Claude file must disappear from the ending tree");
      }
      const suffix = path.slice(".claude/skills/".length);
      if (!safeComponents(suffix)) refuse(options, path, "the legacy file has an unsafe path");
      const canonicalPath = `.agents/skills/${suffix}`;
      const canonical = afterTree.get(canonicalPath);
      if (canonical?.mode !== "100644" || canonical?.type !== "blob" || canonical?.object !== before.object) {
        refuse(options, path, "each tracked legacy file needs an identical canonical skill file");
      }
      if (denied(canonicalPath, worktree, options.deniedPaths)) {
        refuse(options, canonicalPath, "the canonical destination is explicitly denied");
      }
      const beforeContent = await contentOf(options, before, path);
      const canonicalContent = await contentOf(options, canonical, canonicalPath);
      if (beforeContent !== canonicalContent) {
        refuse(options, path, "the canonical skill content does not match the tracked legacy file");
      }
      const currentCanonical = currentContent(options, canonicalPath);
      if (currentCanonical !== undefined && !entryMatches(currentCanonical, canonicalContent, canonicalPath)) {
        const beforeCanonical = await contentOf(options, beforeTree.get(canonicalPath), canonicalPath);
        if (!entryMatches(currentCanonical, beforeCanonical, canonicalPath)) {
          refuse(options, canonicalPath, "the destination does not match its checked before or after content");
        }
      }
      legacyMovePaths.add(path);
    }
  }
  const entries: MaterializedEntry[] = [];
  for (const path of changedPaths.filter(isProtectedPath)) {
    if (legacyMovePaths.has(path)) continue;
    if (path === ".claude/skills") {
      const before = beforeTree.get(path);
      const after = afterTree.get(path);
      const beforeContent = await contentOf(options, before, path);
      const afterContent = await contentOf(options, after, path);
      if (after === undefined) refuse(options, path, "the Claude request must keep the exact link in the ending tree");
      validateSafeEntry(options, path, after, afterContent);
      if (before !== undefined) validateSafeEntry(options, path, before, beforeContent);
      if (currentContent(options, path) !== afterContent) {
        refuse(options, path, "the Claude link must exist in the worktree before tasker materialization");
      }
      continue;
    }
    if (!safeComponents(path)) refuse(options, path, "the path has an unsafe component");
    const before = beforeTree.get(path);
    const after = afterTree.get(path);
    if (path === ".codex/skills" && after === undefined) {
      refuse(options, path, "the Codex request must keep the exact link in the ending tree");
    }
    const beforeContent = await contentOf(options, before, path);
    const afterContent = await contentOf(options, after, path);
    validateSafeEntry(options, path, after, afterContent);
    if (before !== undefined) validateSafeEntry(options, path, before, beforeContent);
    if (path.startsWith(".claude/skills")) refuse(options, path, "the Claude link uses its separate worktree route");
    const current = currentContent(options, path);
    if (!entryMatches(current, beforeContent, path) && !entryMatches(current, afterContent, path)) {
      refuse(options, path, "the destination does not match its checked before or after content");
    }
    entries.push({ path, before, after, beforeContent, afterContent });
  }

  for (const entry of entries) {
    const target = checkParents(options, entry.path);
    if (entry.after === undefined) {
      if (lstatOrUndefined(target) !== undefined) {
        refuseHardLinkedCanonicalDestination(options, entry.path, target);
        unlinkSync(target);
      }
    } else if (entry.path === ".codex/skills") {
      const stat = lstatOrUndefined(target);
      if (!(stat?.isSymbolicLink() && readlinkSync(target) === CODEX_LINK)) {
        mkdirSync(dirname(target), { recursive: true });
        symlinkSync(CODEX_LINK, target);
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      if (!entryMatches(readFileSyncIfRegular(target), entry.afterContent, entry.path)) {
        refuseHardLinkedCanonicalDestination(options, entry.path, target);
        const content = worktreeContent(entry.path, entry.afterContent);
        writeFileSync(target, typeof content === "string" ? content : (content ?? Buffer.alloc(0)), { mode: 0o644 });
      }
      if (entry.path.startsWith(".agents/skills/")) {
        const current = currentContent(options, entry.path);
        if (!entryMatches(current, entry.afterContent, entry.path)) {
          refuse(options, entry.path, "materialized content does not match the ending tree");
        }
      }
    }
  }

  for (const entry of entries) {
    const current = currentContent(options, entry.path);
    if (!entryMatches(current, entry.afterContent, entry.path))
      refuse(options, entry.path, "materialized content does not match the ending tree");
  }
}

function readTreeOutput(options: ProtectedWorkspaceChangeOptions, output: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const record of output.split("\0")) {
    if (record === "") continue;
    const tab = record.indexOf("\t");
    const match = tab < 0 ? null : /^(\d{6}) (blob|commit|tree) ([0-9a-f]+)$/.exec(record.slice(0, tab));
    if (tab < 0 || match === null) refuse(options, "<tree>", "Git returned an invalid tree entry");
    entries.set(record.slice(tab + 1), { mode: match[1], type: match[2], object: match[3] });
  }
  return entries;
}

function readFileSyncIfRegular(path: string): Buffer | undefined {
  const stat = lstatOrUndefined(path);
  if (stat === undefined) return undefined;
  if (!stat.isFile() || stat.isSymbolicLink()) return undefined;
  return readFileSync(path);
}
