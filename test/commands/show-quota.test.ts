import { describe, expect, it } from "vitest";
import { showQuota } from "../../src/commands/show-quota.js";
import { runCommand, runHelp } from "../helpers/cli.js";
import { useThreeRepoDataRoot } from "../helpers/config.js";
import { claudeRateLimitEvent } from "../helpers/fake-claude.js";
import { seedQuotaEvent } from "../helpers/store.js";

const TASKER = "codeguru42/tasker";
const OTHER = "codeguru42/other";

const showQuotaRun = (...extra: string[]) => runCommand(showQuota, "show-quota", ...extra);

// The entry that show-quota prints for a seeded record.
const entryOf = (record: ReturnType<typeof seedQuotaEvent>) => ({
  repo: record.repoKey,
  provider: record.provider,
  receivedAt: record.receivedAt,
  event: record.event,
});

const printed = (entries: unknown[]) => `${JSON.stringify(entries, null, 2)}\n`;

describe("show-quota", () => {
  it("prints an empty list when no repo has a record", async () => {
    useThreeRepoDataRoot();

    expect(await showQuotaRun()).toEqual({ code: 0, out: "[]\n", err: "" });
  });

  it("prints the entry of each repo that has a record, sorted by repo key", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    const tasker = seedQuotaEvent(dataRoot, TASKER);
    const other = seedQuotaEvent(
      dataRoot,
      OTHER,
      claudeRateLimitEvent((info) => {
        info.utilization = 0.5;
      }),
    );

    expect(await showQuotaRun()).toEqual({ code: 0, out: printed([entryOf(other), entryOf(tasker)]), err: "" });
  });

  it.each(["--repo", "-r"])("prints a list of one entry with %s", async (flag) => {
    const { dataRoot } = useThreeRepoDataRoot();
    const tasker = seedQuotaEvent(dataRoot, TASKER);
    seedQuotaEvent(dataRoot, OTHER);

    expect(await showQuotaRun(flag, TASKER)).toEqual({ code: 0, out: printed([entryOf(tasker)]), err: "" });
  });

  it("prints an empty list for a configured repo that has no record", async () => {
    const { dataRoot } = useThreeRepoDataRoot();
    seedQuotaEvent(dataRoot, TASKER);

    expect(await showQuotaRun("--repo", OTHER)).toEqual({ code: 0, out: "[]\n", err: "" });
  });

  it("reports a repo key that does not exist", async () => {
    useThreeRepoDataRoot();

    expect(await showQuotaRun("--repo", "missing")).toEqual({
      code: 1,
      out: "",
      err: "repo key not found: missing\n",
    });
  });

  it("rejects the option --json as every command rejects an unknown option", async () => {
    useThreeRepoDataRoot();

    const result = await showQuotaRun("--json");

    expect(result.code).toBe(1);
    expect(result.out).toBe("");
    expect(result.err).toContain("error: unknown option '--json'");
  });

  it("has a help line", async () => {
    const { code, help } = await runHelp(showQuota, "show-quota");

    expect(code).toBe(0);
    expect(help).toContain("Print the last quota event of each repo as JSON: every repo, or one with --repo");
    expect(help).toContain("-r, --repo <key>");
  });
});
