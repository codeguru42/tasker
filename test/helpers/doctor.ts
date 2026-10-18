import type { Check } from "../../src/doctor/check.js";

// The name, the required flag and the time limit of each check, in the order of the list.
export function checkSummaries(
  checks: readonly Pick<Check, "name" | "required" | "timeoutMs">[],
): { name: string; required: boolean; timeoutMs: number }[] {
  return checks.map(({ name, required, timeoutMs }) => ({ name, required, timeoutMs }));
}
