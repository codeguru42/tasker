import { onTestFinished, vi } from "vitest";
import * as assistantRun from "../../src/tasks/assistant-run.js";

type PlanModeStartInput = Parameters<Awaited<ReturnType<typeof assistantRun.prepareTaskPlanModeRun>>["start"]>[0];
type ExecuteStartInput = Parameters<Awaited<ReturnType<typeof assistantRun.prepareTaskExecuteRun>>["start"]>[0];

export function captureAssistantStartInputs(name: "prepareTaskPlanModeRun"): PlanModeStartInput[];
export function captureAssistantStartInputs(name: "prepareTaskExecuteRun"): ExecuteStartInput[];
export function captureAssistantStartInputs(
  name: "prepareTaskPlanModeRun" | "prepareTaskExecuteRun",
): (PlanModeStartInput | ExecuteStartInput)[] {
  const inputs: (PlanModeStartInput | ExecuteStartInput)[] = [];
  const prepareOriginal = assistantRun[name].bind(assistantRun) as (
    request:
      | Parameters<typeof assistantRun.prepareTaskPlanModeRun>[0]
      | Parameters<typeof assistantRun.prepareTaskExecuteRun>[0],
  ) => Promise<
    | Awaited<ReturnType<typeof assistantRun.prepareTaskPlanModeRun>>
    | Awaited<ReturnType<typeof assistantRun.prepareTaskExecuteRun>>
  >;
  const spy = vi
    .spyOn(assistantRun, name)
    .mockImplementation(
      async (
        request: Parameters<typeof assistantRun.prepareTaskPlanModeRun>[0] &
          Parameters<typeof assistantRun.prepareTaskExecuteRun>[0],
      ) => {
        const prepared = await prepareOriginal(request);
        const start = prepared.start.bind(prepared);
        prepared.start = (input: PlanModeStartInput | ExecuteStartInput) => {
          inputs.push(input);
          return start(input);
        };
        return prepared;
      },
    );
  onTestFinished(() => spy.mockRestore());
  return inputs;
}
