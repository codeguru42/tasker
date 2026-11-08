import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FakeAnswer } from "./fake-commands.js";
import { answerChecks, writeFakeCommand } from "./fake-commands.js";
import { shellQuote } from "../../src/shell-quote.js";
import { useTempDir } from "./temp.js";

// Matching calls use their scripts in order, then keep using the last matching script.
export interface FakePiAnswer extends FakeAnswer {
  stream?: unknown[];
  session?: unknown[];
  sessionFile?: string;
}

export interface FakePi {
  env: NodeJS.ProcessEnv;
  logPath: string;
  calls(): { args: string[]; stdin: string; envNames: string[]; env: Record<string, string | undefined> }[];
  unanswered(): string[][];
}

export function useFakePi(answers: readonly FakePiAnswer[], logEnv: readonly string[] = []): FakePi {
  const dir = useTempDir("tasker-fake-pi-");
  const bin = join(dir, "bin");
  const program = join(bin, "pi");
  const logPath = join(dir, "pi.log");
  const controlPath = join(dir, "control.json");
  writeFileSync(controlPath, JSON.stringify({ answers, logPath, logEnv }));
  const fixture = fileURLToPath(new URL("../fixtures/fake-assistant.ts", import.meta.url));
  const loader = import.meta.resolve("tsx");
  writeFakeCommand(
    bin,
    "pi",
    `exec ${[process.execPath, "--import", loader, fixture, controlPath].map(shellQuote).join(" ")} "$@"`,
  );
  const checks = answerChecks("pi", logPath);
  return {
    env: { PATH: bin, TASKER_PI_BIN: program },
    logPath,
    calls: () =>
      existsSync(logPath)
        ? readFileSync(logPath, "utf8")
            .split("\n")
            .filter((line) => line !== "")
            .map(
              (line) =>
                JSON.parse(line) as {
                  args: string[];
                  stdin: string;
                  envNames: string[];
                  env: Record<string, string | undefined>;
                },
            )
        : [],
    unanswered: checks.unanswered,
  };
}
