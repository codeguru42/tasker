import { detailSuffix } from "../detail-suffix.js";
import type { Check, CheckResult } from "./check.js";

const INDENT = "      "; // the width of "error" and one space

// The output of one check. The first line is "<status> <name>: <first line of the detail>".
// The other lines of the detail follow, then the lines of the remediation, each with INDENT.
export function formatResult(check: Pick<Check, "name">, result: CheckResult): string {
  const [first, ...rest] = result.detail.split("\n");
  const head = `${result.status.padEnd(5)} ${check.name}${detailSuffix(first)}`;
  const more = [...rest, ...(result.remediation?.split("\n") ?? [])].map((line) => `${INDENT}${line}`);
  return [head, ...more].map((line) => `${line}\n`).join("");
}

// Runs the checks one at a time. It writes the output of each check before the next check starts.
// It gives the exit code: 1 when a check with required: true gives error, else 0.
// The timeout rules are in timedCheck(), which builds each check.
export async function runChecks(
  checks: readonly Check[],
  env: NodeJS.ProcessEnv,
  write: (text: string) => void,
): Promise<number> {
  let code = 0;
  for (const check of checks) {
    const result = await check.run(env);
    write(formatResult(check, result));
    if (check.required && result.status === "error") {
      code = 1;
    }
  }
  return code;
}
