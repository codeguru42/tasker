import { detailSuffix } from "../detail-suffix.js";
import type { Check, CheckResult } from "../doctor/check.js";
import { firstLine } from "../doctor/first-line.js";
import { timedCheck } from "../doctor/timed-check.js";
import { childEnv } from "../process/child-env.js";
import { CommandNotFoundError, runChild, type ChildResult } from "../process/run-child.js";

export interface ProgramCheckSpec {
  name: string;
  program: string;
  args: readonly string[];
  notInstalled: string;
  remediation: string;
  timeoutMs: number;
  // Reads a child that no signal stopped. exitDetail is the detail for a failed exit.
  readChild: (child: ChildResult, exitDetail: string) => CheckResult;
}

export interface RunProgramCheckSpec {
  program: string;
  args: readonly string[];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  notInstalled: string;
  remediation: string;
  readChild: ProgramCheckSpec["readChild"];
}

export async function runProgramCheck(spec: RunProgramCheckSpec): Promise<CheckResult> {
  const { program, args, env, signal, notInstalled, remediation, readChild } = spec;
  let child;
  try {
    child = await runChild(program, args, { env, signal });
  } catch (error) {
    if (error instanceof CommandNotFoundError) {
      return { status: "error", detail: notInstalled, remediation };
    }
    throw error;
  }
  const command = [program, ...args].join(" ");
  if (child.signal !== null) {
    return { status: "error", detail: `${command} was killed by ${child.signal}` };
  }
  const exitDetail = `${command} exited ${String(child.code)}${detailSuffix(firstLine(child.stderr))}`;
  return readChild(child, exitDetail);
}

// Only a missing program gets the fix, because only an install fixes that cause.
export function programCheck(spec: ProgramCheckSpec): Check {
  const { name, program, args, notInstalled, remediation, timeoutMs, readChild } = spec;
  return timedCheck({ name, required: true, timeoutMs }, async (env, { signal }) =>
    runProgramCheck({
      program,
      args,
      env: childEnv(env, []),
      signal,
      notInstalled,
      remediation,
      readChild,
    }),
  );
}

export interface VersionCheckSpec {
  program: string;
  notInstalled: string;
  remediation: string;
  timeoutMs: number;
}

export function programVersionCheck(spec: VersionCheckSpec): Check {
  const { program, notInstalled, remediation, timeoutMs } = spec;
  return programCheck({
    name: `${program} version`,
    program,
    args: ["--version"],
    notInstalled,
    remediation,
    timeoutMs,
    readChild: (child, exitDetail) =>
      child.code === 0 ? { status: "ok", detail: firstLine(child.stdout) } : { status: "error", detail: exitDetail },
  });
}
