/** Helpers that the tests of the orchestrator prompt templates share. */
import { readFileSync } from "node:fs";
import { packagePath } from "../../src/package-path.js";
import { markdownSection, sharedWordRuns } from "./doc-text.js";

const PROMPT_READ_START = "`Run git branch --show-current.";

/**
 * Give the prompt-read sentence of `docs/dev/handoff.md`, with `roleIndex` in place of
 * each `<role index>`. Throw if the doc has no such line.
 */
export function handoffPromptRead(roleIndex: string): string {
  const doc = readFileSync(packagePath("docs/dev/handoff.md"), "utf8");
  const line = doc.split("\n").find((candidate) => candidate.trim().startsWith(PROMPT_READ_START));
  if (line === undefined) throw new Error("docs/dev/handoff.md has no prompt-read line");
  return line.trim().replace(/^`/, "").replace(/`$/, "").split("<role index>").join(roleIndex);
}

function withoutPromptRead(body: string): string {
  const sentence = handoffPromptRead("docs/orchestrator.md");
  return body.includes(sentence) ? body.replace(sentence, "") : body;
}

/** Count the words of the body, without the prompt-read sentence. */
export function promptWordCount(body: string): number {
  return withoutPromptRead(body)
    .split(/\s+/)
    .filter((word) => word !== "").length;
}

/**
 * Give each run of 8 words that the body, without the prompt-read sentence, shares with the
 * handoff docs, the quota doc and the board watch section of `docs/orchestrator.md`.
 */
export function orchestratorDocWordRuns(body: string): string[] {
  const text = withoutPromptRead(body);
  const section = markdownSection(readFileSync(packagePath("docs/orchestrator.md"), "utf8"), "The board watch job");
  if (section === undefined) throw new Error("docs/orchestrator.md has no section The board watch job");
  const docs = [
    readFileSync(packagePath("docs/dev/handoff.md"), "utf8"),
    readFileSync(packagePath("docs/dev/handoff-orchestrator.md"), "utf8"),
    readFileSync(packagePath("docs/dev/quota.md"), "utf8"),
    section,
  ];
  const runs = new Set<string>();
  for (const doc of docs) {
    for (const run of sharedWordRuns(text, doc)) runs.add(run);
  }
  return [...runs];
}
