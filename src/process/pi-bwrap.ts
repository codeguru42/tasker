import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import type { ChildProcess } from "node:child_process";
import { constants } from "node:os";
import { errnoCode } from "../errno.js";

export interface PiBwrapOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  onData(data: string): void;
  signal?: AbortSignal;
  timeout?: number;
}

export function childExitCode(code: number | null, signal: string | null): number {
  if (code !== null) return code;
  if (signal === null) return 1;
  return 128 + (osSignalNumber(signal) ?? 0);
}

export function spawnPiBwrap(program: string, args: readonly string[], options: PiBwrapOptions): Promise<number> {
  if (options.signal?.aborted) return Promise.reject(new Error("aborted"));
  try {
    if (!statSync(options.cwd).isDirectory()) throw new Error("cwd does not exist");
  } catch (error) {
    if (errnoCode(error) === "ENOENT" || errnoCode(error) === "ENOTDIR") {
      return Promise.reject(new Error("cwd does not exist"));
    }
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(program, [...args], {
        cwd: options.cwd,
        env: options.env,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stoppedBy: "abort" | "timeout" | undefined;
    let timer: NodeJS.Timeout | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    const stop = (reason: "abort" | "timeout") => {
      if (stoppedBy !== undefined) return;
      stoppedBy = reason;
      if (child.pid !== undefined) killGroup(child.pid);
    };
    const abort = () => stop("abort");

    child.stdout?.on("data", (chunk: Buffer | string) => options.onData(chunk.toString()));
    child.stderr?.on("data", (chunk: Buffer | string) => options.onData(chunk.toString()));
    child.once("error", (error) => {
      cleanup();
      reject(
        stoppedBy === "abort" ? new Error("aborted") : stoppedBy === "timeout" ? timeoutError(options.timeout) : error,
      );
    });
    child.once("close", (code, signal) => {
      cleanup();
      if (stoppedBy === "abort") reject(new Error("aborted"));
      else if (stoppedBy === "timeout") reject(timeoutError(options.timeout));
      else resolve(childExitCode(code, signal));
    });

    if (options.signal !== undefined) {
      options.signal.addEventListener("abort", abort, { once: true });
      if (options.signal.aborted) abort();
    }
    if (options.timeout !== undefined) timer = setTimeout(() => stop("timeout"), options.timeout);
  });
}

function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (errnoCode(error) !== "ESRCH") throw error;
  }
}

function timeoutError(timeout: number | undefined): Error {
  return new Error(`timeout:${timeout ?? 0}`);
}

function osSignalNumber(signal: string): number | undefined {
  const name = signal.startsWith("SIG") ? signal : `SIG${signal}`;
  return constants.signals[name as keyof typeof constants.signals];
}
