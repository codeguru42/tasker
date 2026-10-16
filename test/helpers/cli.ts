import { type Io, type RegisterCommand, run } from "../../src/cli.js";

export interface CapturedIo extends Io {
  out: string[];
  err: string[];
  questions: string[];
}

// With answers, the io has a prompt that gives the next answer, and rejects when none is left.
export function captureIo(options: { answers?: string[] } = {}): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  const questions: string[] = [];
  const answers = options.answers === undefined ? undefined : [...options.answers];
  const io: CapturedIo = {
    out,
    err,
    questions,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
  };
  if (answers !== undefined) {
    io.prompt = (question) => {
      questions.push(question);
      const answer = answers.shift();
      return answer === undefined ? Promise.reject(new Error("no answer left")) : Promise.resolve(answer);
    };
  }
  return io;
}

export const greet: RegisterCommand = (program) => {
  program.command("greet").description("Say hello").option("--name <name>", "Who to greet");
};

// Runs argv with only this command and gives the exit code and the whole stdout and stderr.
export async function runCommand(
  command: RegisterCommand,
  ...argv: string[]
): Promise<{ code: number; out: string; err: string }> {
  const io = captureIo();
  const code = await run(argv, { commands: [command], io });
  return { code, out: io.out.join(""), err: io.err.join("") };
}
