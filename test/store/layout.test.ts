import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDataRoot,
  dataRootLayout,
  doctorProbePath,
  planRevisionPath,
  taskArtifactsDir,
  taskLogsDir,
  taskPlansDir,
} from "../../src/store/layout.js";
import { useTempDir } from "../helpers.js";

describe("dataRootLayout", () => {
  it("puts the folders and the database directly under the data root", () => {
    expect(dataRootLayout("/d")).toEqual({
      root: "/d",
      clones: "/d/clones",
      artifacts: "/d/artifacts",
      prompts: "/d/prompts",
      database: "/d/tasker.db",
    });
  });
});

describe("taskArtifactsDir", () => {
  it("puts the files of an attempt under the slug of the issue key", () => {
    expect(
      taskArtifactsDir("/d", { issueKey: "codeguru42/tasker#10", attempt: 2 }),
    ).toBe("/d/artifacts/codeguru42-tasker-10/attempt-2");
  });

  it("keeps an issue key that has no unsafe character", () => {
    expect(taskArtifactsDir("/d", { issueKey: "PROJ-7", attempt: 1 })).toBe(
      "/d/artifacts/PROJ-7/attempt-1",
    );
  });

  it("makes no folder", () => {
    const root = useTempDir("tasker-data-");
    const path = taskArtifactsDir(root, { issueKey: "PROJ-7", attempt: 1 });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dataRootLayout(root).artifacts)).toBe(false);
  });
});

describe("taskLogsDir", () => {
  it("puts the logs in the logs folder of the files of the attempt", () => {
    const task = { issueKey: "codeguru42/tasker#10", attempt: 2 };
    expect(taskLogsDir("/d", task)).toBe(join(taskArtifactsDir("/d", task), "logs"));
  });

  it("makes no folder", () => {
    const root = useTempDir("tasker-data-");
    const path = taskLogsDir(root, { issueKey: "PROJ-7", attempt: 1 });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dataRootLayout(root).artifacts)).toBe(false);
  });
});

describe("taskPlansDir", () => {
  it("puts the plan files in the plans folder of the files of the attempt", () => {
    expect(taskPlansDir("/d", { issueKey: "codeguru42/tasker#10", attempt: 2 })).toBe(
      "/d/artifacts/codeguru42-tasker-10/attempt-2/plans",
    );
  });

  it("makes no folder", () => {
    const root = useTempDir("tasker-data-");
    const path = taskPlansDir(root, { issueKey: "PROJ-7", attempt: 1 });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dataRootLayout(root).artifacts)).toBe(false);
  });
});

describe("planRevisionPath", () => {
  it("names the file of a revision v<N>.md in the plans folder", () => {
    const task = { issueKey: "codeguru42/tasker#10", attempt: 2 };
    expect(planRevisionPath("/d", task, 3)).toBe(join(taskPlansDir("/d", task), "v3.md"));
  });

  it("makes no file and no folder", () => {
    const root = useTempDir("tasker-data-");
    const path = planRevisionPath(root, { issueKey: "PROJ-7", attempt: 1 }, 1);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(dataRootLayout(root).artifacts)).toBe(false);
  });
});

describe("createDataRoot", () => {
  let dir: string;

  beforeEach(() => {
    dir = useTempDir("tasker-data-");
  });

  it("creates a missing root, clones, artifacts and prompts", () => {
    const root = join(dir, "root");
    const layout = createDataRoot(root);
    expect(layout).toEqual(dataRootLayout(root));
    for (const path of [root, layout.clones, layout.artifacts, layout.prompts]) {
      expect(statSync(path).isDirectory()).toBe(true);
    }
    expect(existsSync(join(root, "worktrees"))).toBe(false);
  });

  it("keeps a top worktrees folder that exists", () => {
    const root = join(dir, "root");
    mkdirSync(join(root, "worktrees"), { recursive: true });
    writeFileSync(join(root, "worktrees", "keep.txt"), "kept");
    createDataRoot(root);
    expect(readFileSync(join(root, "worktrees", "keep.txt"), "utf8")).toBe("kept");
  });

  it("does not throw on a second call and keeps existing content", () => {
    const root = join(dir, "root");
    const layout = createDataRoot(root);
    mkdirSync(join(layout.clones, "repo"));
    writeFileSync(join(layout.clones, "keep.txt"), "kept");
    expect(() => createDataRoot(root)).not.toThrow();
    expect(readFileSync(join(layout.clones, "keep.txt"), "utf8")).toBe("kept");
    expect(statSync(join(layout.clones, "repo")).isDirectory()).toBe(true);
  });
});

describe("doctorProbePath", () => {
  it("puts a file with the pid and a uuid in its name directly under the data root", () => {
    const path = doctorProbePath("/d");
    expect(dirname(path)).toBe("/d");
    expect(basename(path)).toMatch(new RegExp(`^\\.doctor-probe-${process.pid}-[0-9a-f-]{36}$`));
  });

  it("gives a different path for each call", () => {
    expect(doctorProbePath("/d")).not.toBe(doctorProbePath("/d"));
  });

  it("makes no file", () => {
    const dir = useTempDir("tasker-probe-path-");
    doctorProbePath(dir);
    expect(readdirSync(dir)).toEqual([]);
  });
});
