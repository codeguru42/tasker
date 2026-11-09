import { checkBashCommand } from "./bash-command-check.js";
import { sandboxArgs } from "./sandbox-args.js";
import type { PiSandboxLimits } from "./guard-limits.js";
import { spawnPiBwrap } from "../../process/pi-bwrap.js";

export interface BashExecOptions {
  onData(data: string): void;
  signal?: AbortSignal;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

export interface BashOperations {
  exec(command: string, cwd: string, options: BashExecOptions): Promise<number>;
}

export function createBashOperations(sandbox: PiSandboxLimits, deniedCommands: readonly string[]): BashOperations {
  return {
    async exec(command, cwd, options) {
      if (options.signal?.aborted) throw new Error("aborted");
      if (typeof command !== "string") throw new Error("command is not a string");
      const env = options.env ?? process.env;
      const built = sandboxArgs({ sandbox, cwd, command, env });
      if ("reason" in built) throw new Error(built.reason);
      const check = checkBashCommand(command, deniedCommands);
      if (check.block) throw new Error(check.reason);
      return spawnPiBwrap(sandbox.bwrap, built.args, {
        cwd,
        env,
        onData: (data) => options.onData(data),
        signal: options.signal,
        timeout: options.timeout,
      });
    },
  };
}
