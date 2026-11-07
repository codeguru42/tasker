import type { FakeAnswer } from "./fake-commands.js";

export interface FakePi {
  env: NodeJS.ProcessEnv;
  logPath: string;
  calls(): { args: string[]; env: Record<string, string | undefined> }[];
  unanswered(): string[][];
}

export function useFakePi(_answers: readonly FakeAnswer[], _logEnv: readonly string[] = []): FakePi {
  throw new Error(`useFakePi is not implemented for ${_answers.length} answers and ${_logEnv.length} env names`);
}
