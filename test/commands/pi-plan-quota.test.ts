import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { plan } from "../../src/commands/plan.js";
import { resume } from "../../src/commands/resume.js";
import { withTrustedExtensions } from "../helpers/config.js";
import { useFakePi } from "../helpers/fake-pi.js";
import { piQuotaStream } from "../helpers/pi-quota-streams.js";
import { eventDataOf, latestTaskOf, withDataRootStore } from "../helpers/store.js";
import { usePlanFixture } from "../helpers/task-fixtures.js";
import { useProcessEnv, useTempDir } from "../helpers/temp.js";
import { runCommand } from "../helpers/cli.js";

const providerFiles = vi.hoisted(() => ({ guardFile: "", answerFile: "" }));
vi.mock("../../src/assistant/pi/provider.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/assistant/pi/provider.js")>();
  return {
    ...actual,
    createPiProvider: () => actual.createPiProvider(providerFiles),
  };
});

const KEY = "codeguru42/tasker#5";
const REPO = "codeguru42/tasker";
const TRUSTED = ["builtin:llama.cpp", "builtin:codemode", "builtin:tool-search"];

describe("pi plan quota pause", () => {
  it("pauses on plan and resumes the same pi session", async () => {
    const dir = useTempDir("tasker-pi-command-extensions-");
    providerFiles.guardFile = join(dir, "guard.js");
    providerFiles.answerFile = join(dir, "answer.js");
    writeFileSync(providerFiles.guardFile, "export default function guard() {}\n");
    writeFileSync(providerFiles.answerFile, "export default function answer() {}\n");

    const fixture = await usePlanFixture(
      {},
      {
        repo: {
          assistant: {
            provider: "pi",
            models: {
              plan: { model: "openrouter/auto", effort: "low" },
              execute: { model: "openrouter/auto", effort: "low" },
              review: { model: "openrouter/auto", effort: "low" },
            },
          },
        },
      },
    );
    const trusted = withTrustedExtensions(fixture.started.config, REPO, TRUSTED);
    writeFileSync(fixture.started.configPath, JSON.stringify(trusted));
    const record = piQuotaStream("quotaDelay");
    const fake = useFakePi([
      { args: [], stream: record.stdout, session: record.session },
      { args: [], stream: record.stdout, session: record.session },
    ]);
    const path = [fake.env.PATH, ...(process.env.PATH === undefined ? [] : [process.env.PATH])].join(":");
    useProcessEnv({ ...fake.env, PATH: path });

    const before = Math.floor(Date.now() / 1000);
    const planResult = await runCommand(plan, "plan", KEY, "--repo", REPO);
    const firstTask = latestTaskOf(fixture.started.dataRoot, KEY);
    const session = withDataRootStore(fixture.started.dataRoot, (store) => store.planSession(firstTask.id));
    const firstCall = fake.calls()[0];
    expect(firstTask.state, JSON.stringify({ planResult, calls: fake.calls() })).toBe("quota_blocked");
    const pause = eventDataOf(fixture.started.dataRoot, KEY, "transition").at(-1) as {
      cause?: string;
      resetsAt?: number;
    };
    expect(pause.cause).toBe("rate_limit");
    expect(pause.resetsAt).toBeGreaterThanOrEqual(before + 3600);
    expect(pause.resetsAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 3600);
    expect(
      firstCall.args.slice(firstCall.args.indexOf("--session-id"), firstCall.args.indexOf("--session-id") + 2),
    ).toEqual(["--session-id", session?.sessionId]);

    const resumeResult = await runCommand(resume, "resume", KEY, "--repo", REPO);
    const secondTask = latestTaskOf(fixture.started.dataRoot, KEY);
    const calls = fake.calls();
    expect(secondTask.state, JSON.stringify({ resumeResult, calls })).toBe("quota_blocked");
    expect(calls).toHaveLength(2);
    expect(calls[1].args.slice(calls[1].args.indexOf("--session"), calls[1].args.indexOf("--session") + 2)).toEqual([
      "--session",
      session?.sessionId,
    ]);
    expect(calls[1].args[calls[1].args.indexOf("--session-dir") + 1]).toBe(
      calls[0].args[calls[0].args.indexOf("--session-dir") + 1],
    );
  });
});
