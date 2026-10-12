import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DeadlineError,
  findStaleLocks,
  onceProcView,
  readProcView,
} from "../../../src/vcs/git/stale-locks.js";
import { ageFile, makeTempDir, writeFakeProc } from "../../helpers.js";

const HOUR = 3_600_000;

describe("findStaleLocks", () => {
  let dir: string;
  let clone: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-stale-locks-");
    clone = join(dir, "repo.git");
    mkdirSync(join(clone, "refs", "heads"), { recursive: true });
    mkdirSync(join(clone, "objects"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function lock(relative: string, ageMs: number): void {
    const path = join(clone, relative);
    writeFileSync(path, "");
    ageFile(path, ageMs);
  }

  function find(): string[] {
    return findStaleLocks(clone, Date.now(), Date.now() + 10000).map((found) => found.path);
  }

  it("finds an aged lock and an aged lock in a folder", () => {
    lock("a.lock", HOUR);
    lock("refs/heads/x.lock", HOUR);
    const root = realpathSync(clone);
    expect(find()).toEqual([join(root, "a.lock"), join(root, "refs", "heads", "x.lock")]);
  });

  it("gives the age of a lock", () => {
    lock("a.lock", HOUR);
    const [found] = findStaleLocks(clone, Date.now(), Date.now() + 10000);
    expect(found.ageMs).toBeGreaterThanOrEqual(HOUR);
    expect(found.ageMs).toBeLessThan(HOUR + 10000);
  });

  it("does not find a fresh lock", () => {
    lock("a.lock", 1000);
    expect(find()).toEqual([]);
  });

  it("does not find a file that is not a lock", () => {
    lock("HEAD", HOUR);
    expect(find()).toEqual([]);
  });

  it("does not look in objects", () => {
    lock("objects/x.lock", HOUR);
    expect(find()).toEqual([]);
  });

  it("does not follow a link to a folder", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "b.lock"), "");
    ageFile(join(outside, "b.lock"), HOUR);
    symlinkSync(outside, join(clone, "linked"));
    expect(find()).toEqual([]);
  });

  it("does not find a link that is named like a lock", () => {
    lock("target", HOUR);
    symlinkSync(join(clone, "target"), join(clone, "c.lock"));
    expect(find()).toEqual([]);
  });

  it("throws a DeadlineError when the deadline has passed", () => {
    lock("a.lock", HOUR);
    expect(() => findStaleLocks(clone, Date.now(), Date.now())).toThrow(DeadlineError);
  });
});

describe("readProcView", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-proc-view-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives the open files and the folders of git processes", () => {
    const root = join(dir, "proc");
    writeFakeProc(root, [
      { pid: 10, comm: "git", cwd: "/some/clone", openFiles: ["/some/clone/index.lock"] },
      { pid: 11, comm: "git-upload-pack", cwd: "/other" },
      { pid: 12, comm: "bash", cwd: "/home", openFiles: ["/tmp/x"] },
    ]);
    mkdirSync(join(root, "self"));
    const view = readProcView(root);
    expect(view).toEqual({
      readable: true,
      openFiles: new Set(["/some/clone/index.lock", "/tmp/x"]),
      gitCwds: ["/some/clone", "/other"],
    });
  });

  it("skips a process that has no fd folder", () => {
    const root = join(dir, "proc");
    writeFakeProc(root, [
      { pid: 1, comm: "init" },
      { pid: 2, comm: "bash", openFiles: ["/tmp/y"] },
    ]);
    expect(readProcView(root)).toEqual({
      readable: true,
      openFiles: new Set(["/tmp/y"]),
      gitCwds: [],
    });
  });

  it("gives readable false for a root that is missing", () => {
    const view = readProcView(join(dir, "missing"));
    expect(view.readable).toBe(false);
    expect(view).toMatchObject({ reason: "ENOENT" });
  });
});

describe("onceProcView", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("tasker-once-proc-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("gives undefined on a platform that is not Linux", () => {
    const root = join(dir, "proc");
    writeFakeProc(root, [{ pid: 1, comm: "git", openFiles: ["/x"] }]);
    expect(onceProcView(root, "darwin")()).toBeUndefined();
  });

  it("reads once on Linux", () => {
    const root = join(dir, "proc");
    writeFakeProc(root, [{ pid: 1, comm: "bash", openFiles: ["/x"] }]);
    const view = onceProcView(root, "linux");
    const first = view();
    writeFakeProc(root, [{ pid: 2, comm: "bash", openFiles: ["/y"] }]);
    expect(first).toEqual({ readable: true, openFiles: new Set(["/x"]), gitCwds: [] });
    expect(view()).toBe(first);
  });
});
