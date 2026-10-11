import { Command, CommanderError } from "commander";
import { readVersion } from "./version.js";

export interface Io {
  stdout(text: string): void;
  stderr(text: string): void;
}

export type RegisterCommand = (program: Command) => void;

export interface RunOptions {
  commands?: readonly RegisterCommand[];
  io?: Io;
}

const defaultIo: Io = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export function buildProgram(commands: readonly RegisterCommand[], io: Io): Command {
  const program = new Command("tasker")
    .description("Drive an AI coding assistant through an issue")
    .version(readVersion())
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride();
  for (const register of commands) {
    register(program);
  }
  return program;
}

export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const program = buildProgram(options.commands ?? [], options.io ?? defaultIo);
  try {
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode;
    }
    throw err;
  }
}
