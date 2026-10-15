import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import { loadConfig } from "../../src/config/load.js";
import { parseConfig } from "../../src/config/schema.js";
import { IssueKeyError } from "../../src/issue-key/ref.js";
import { resolveIssueKey } from "../../src/issue-key/resolve.js";
import {
  issueKeyErrorMessage,
  threeRepoConfig,
  useConfigFile,
  useThreeRepoDataRoot,
  validConfig,
  writeDataRootConfig,
} from "./config.js";

describe("writeDataRootConfig", () => {
  let dir: string;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes config.json with dataRoot set to the data folder of the dir", () => {
    const raw = validConfig();
    const written = writeDataRootConfig(raw);
    dir = written.dir;

    expect(written.path).toBe(join(dir, "config.json"));
    expect(written.dataRoot).toBe(join(dir, "data"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toEqual({
      ...validConfig(),
      dataRoot: join(dir, "data"),
    });
  });

  it("does not change its input", () => {
    const raw = validConfig();
    dir = writeDataRootConfig(raw).dir;

    expect(raw).toEqual(validConfig());
  });
});

describe("threeRepoConfig", () => {
  it("passes parseConfig with the repos tasker, other and fork", () => {
    const config = parseConfig(threeRepoConfig(), {}, "/home/me");

    expect(Object.keys(config.repos).sort()).toEqual(["codeguru42/other", "codeguru42/tasker", "fork"]);
    expect(config.repos.fork.issueTracker.project).toBe("codeguru42/tasker");
  });
});

describe("useConfigFile", () => {
  it("writes the text of build as config.json and gives build the data root", () => {
    const seen: string[] = [];
    const written = useConfigFile((dataRoot) => {
      seen.push(dataRoot);
      return `{"dataRoot":"${dataRoot}"}\n`;
    });

    expect(written.path).toBe(join(written.dir, "config.json"));
    expect(written.dataRoot).toBe(join(written.dir, "data"));
    expect(seen).toEqual([written.dataRoot]);
    expect(readFileSync(written.path, "utf8")).toBe(`{"dataRoot":"${written.dataRoot}"}\n`);
  });

  it("points TASKER_CONFIG at the file", () => {
    const written = useConfigFile(() => "{}");

    expect(process.env.TASKER_CONFIG).toBe(written.path);
  });

  it("removes the folder and the env stub after the test", () => {
    // onTestFinished callbacks run in reverse order, so this check runs after the cleanup of the helper.
    const holder: { written?: ReturnType<typeof useConfigFile> } = {};
    onTestFinished(() => {
      const { written } = holder;
      expect(written).toBeDefined();
      if (!written) return;
      expect(existsSync(written.dir)).toBe(false);
      expect(process.env.TASKER_CONFIG).not.toBe(written.path);
    });

    const written = useConfigFile(() => "{}");
    holder.written = written;

    expect(existsSync(written.dir)).toBe(true);
  });
});

describe("useThreeRepoDataRoot", () => {
  it("points TASKER_CONFIG at the written configuration", () => {
    const written = useThreeRepoDataRoot();

    expect(process.env.TASKER_CONFIG).toBe(written.path);
    expect(written.dataRoot).toBe(join(written.dir, "data"));
    expect(JSON.parse(readFileSync(written.path, "utf8"))).toEqual({
      ...threeRepoConfig(),
      dataRoot: written.dataRoot,
    });
  });

  it("removes the folder and the env stub after the test", () => {
    // onTestFinished callbacks run in reverse order, so this check runs after the cleanup of the helper.
    const holder: { written?: ReturnType<typeof useThreeRepoDataRoot> } = {};
    onTestFinished(() => {
      const { written } = holder;
      expect(written).toBeDefined();
      if (!written) return;
      expect(existsSync(written.dir)).toBe(false);
      expect(process.env.TASKER_CONFIG).not.toBe(written.path);
    });

    const written = useThreeRepoDataRoot();
    holder.written = written;

    expect(existsSync(written.dir)).toBe(true);
  });
});

describe("issueKeyErrorMessage", () => {
  it("gives the message of the error that resolveIssueKey throws", () => {
    const { path } = useThreeRepoDataRoot();
    let expected = "";
    try {
      resolveIssueKey("nobody/else#1", loadConfig({ TASKER_CONFIG: path }));
    } catch (error) {
      if (!(error instanceof IssueKeyError)) throw error;
      expected = error.message;
    }

    expect(expected).not.toBe("");
    expect(issueKeyErrorMessage("nobody/else#1", path)).toBe(expected);
  });

  it("fails the test for a key that resolves", () => {
    const { path } = useThreeRepoDataRoot();

    expect(() => issueKeyErrorMessage("codeguru42/other#1", path)).toThrow();
  });
});
