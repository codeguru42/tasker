import { checkBashCommand } from "./bash-command-check.js";
import { sandboxArgs } from "./sandbox-args.js";
import type { PiSandboxLimits } from "./guard-limits.js";
import { spawnPiBwrap } from "../../process/pi-bwrap.js";

export interface BashExecOptions {
  onData(data: Buffer): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BashOperations {
  exec(command: string, cwd: string, options: BashExecOptions): Promise<{ exitCode: number }>;
}

export function createBashOperations(sandbox: PiSandboxLimits, deniedCommands: readonly string[]): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (options.signal?.aborted) throw new Error("aborted");
      if (typeof command !== "string") throw new Error("command is not a string");
      if (options.timeout !== undefined && (!Number.isFinite(options.timeout) || options.timeout <= 0)) {
        throw new Error("Invalid timeout: must be a finite number of seconds");
      }
      const env = options.env ?? process.env;
      const built = sandboxArgs({ sandbox, cwd, command });
      if ("reason" in built) throw new Error(built.reason);
      const check = checkBashCommand(command, deniedCommands);
      if (check.block) throw new Error(check.reason);
      try {
        const exitCode = await spawnPiBwrap(sandbox.bwrap, built.args, {
          cwd,
          env,
          onData: (data) => options.onData(data),
          signal: options.signal,
          timeout: options.timeout === undefined ? undefined : options.timeout * 1000,
        });
        return { exitCode };
      } catch (error) {
        if (options.timeout !== undefined && error instanceof Error && error.message.startsWith("timeout:")) {
          throw new Error(`timeout:${options.timeout}`, { cause: error });
        }
        throw error;
      }
    },
  };
}
