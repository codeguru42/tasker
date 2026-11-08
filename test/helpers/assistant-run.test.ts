import { describe, expect, it, onTestFinished } from "vitest";
import * as assistantRun from "../../src/tasks/assistant-run.js";
import { captureAssistantStartInputs } from "./assistant-run.js";
import { claudeSample } from "./fake-claude.js";
import { withDataRootStore } from "./store.js";
import { useAssistantRunFixture } from "./task-fixtures.js";

describe("captureAssistantStartInputs", () => {
  it("records plan-mode start inputs in order and restores its spy", async () => {
    const originalPrepare = assistantRun.prepareTaskPlanModeRun;
    onTestFinished(() => expect(assistantRun.prepareTaskPlanModeRun).toBe(originalPrepare));
    const inputs = captureAssistantStartInputs("prepareTaskPlanModeRun");
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("plain") }, state: "planning" });
    const first = { prompt: "first" };
    const second = { prompt: "second" };

    await withDataRootStore(fixture.started.dataRoot, async (store) => {
      const prepared = await assistantRun.prepareTaskPlanModeRun({
        config: fixture.config,
        store,
        task: fixture.task,
        role: "plan",
        session: { resume: false },
        env: fixture.env,
      });
      await prepared.start(first);
      await prepared.start(second);
    });

    expect(inputs).toEqual([first, second]);
  });

  it("records execute start inputs in order and restores its spy", async () => {
    const originalPrepare = assistantRun.prepareTaskExecuteRun;
    onTestFinished(() => expect(assistantRun.prepareTaskExecuteRun).toBe(originalPrepare));
    const inputs = captureAssistantStartInputs("prepareTaskExecuteRun");
    const fixture = await useAssistantRunFixture({ claude: { stream: claudeSample("plain") }, state: "executing" });
    const first = { prompt: "first" };
    const second = { prompt: "second", timeoutMs: 1000 };

    await withDataRootStore(fixture.started.dataRoot, async (store) => {
      const prepared = await assistantRun.prepareTaskExecuteRun({
        config: fixture.config,
        store,
        task: fixture.task,
        session: { resume: false },
        env: fixture.env,
      });
      await prepared.start(first);
      await prepared.start(second);
    });

    expect(inputs).toEqual([first, second]);
  });
});
