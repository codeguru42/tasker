import { createInterface } from "node:readline";
import { Command, CommanderError } from "commander";
import { commands as defaultCommands } from "./commands/index.js";
import { readVersion } from "./version.js";

export interface Io {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  // Asks one question and gives the answer line. Set only when a person can answer.
  prompt?: (question: string) => Promise<string>;
}

export type RegisterCommand = (program: Command, io: Io) => void;

export interface RunOptions {
  commands?: readonly RegisterCommand[];
  io?: Io;
}

interface IoStreams {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

// The Io of a process. The question goes to stderr, so stdout holds only the result.
// The readline interface exists only while one prompt runs.
export function createDefaultIo(
  streams: IoStreams = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
): Io {
  const io: Io = {
    stdout: (text) => streams.stdout.write(text),
    stderr: (text) => streams.stderr.write(text),
  };
  if (streams.stdin.isTTY) {
    io.prompt = (question) =>
      new Promise<string>((resolve, reject) => {
        const rl = createInterface({ input: streams.stdin, output: streams.stderr });
        // Set when the answer or the cancel came, so that close does not reject again.
        let answered = false;
        rl.once("close", () => {
          if (!answered) reject(new Error("no answer: the input closed"));
        });
        rl.once("SIGINT", () => {
          answered = true;
          rl.close();
          reject(new Error("no answer: the question was cancelled"));
        });
        rl.question(question, (line) => {
          answered = true;
          rl.close();
          resolve(line);
        });
      });
  }
  return io;
}

const defaultIo: Io = createDefaultIo();

export function buildProgram(commands: readonly RegisterCommand[], io: Io): Command {
  const program = new Command("tasker")
    .description("Drive an AI coding assistant through an issue")
    .version(readVersion())
    .enablePositionalOptions()
    .configureOutput({ writeOut: io.stdout, writeErr: io.stderr })
    .exitOverride()
    .showHelpAfterError("(run 'tasker --help' for usage)");
  for (const register of commands) {
    register(program, io);
  }
  return program;
}

export async function run(argv: readonly string[], options: RunOptions = {}): Promise<number> {
  const program = buildProgram(options.commands ?? defaultCommands, options.io ?? defaultIo);
  try {
    if (argv.length === 0) {
      program.help({ error: true });
    }
    await program.parseAsync(argv, { from: "user" });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) {
      return err.exitCode;
    }
    throw err;
  }
}
