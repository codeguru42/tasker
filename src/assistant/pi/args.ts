import { upstreamOf } from "../models.js";
import type { RunInput } from "../provider.js";
import { guardStartArgs } from "./guard-start.js";
import { PI_ANSWER_TOOL_NAME } from "./answer-tool.js";

export const PI_READ_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

export interface PiFiles {
  guardFile: string;
  answerFile: string;
}

export function piArgs(input: RunInput, files: PiFiles, limitsPath: string, schemaPath: string | undefined): string[] {
  const upstream = upstreamOf(input.model);
  if (!upstream) throw new Error(`invalid pi model: ${input.model}`);

  const hasAnswerTool = schemaPath !== undefined;
  return [
    "-p",
    "--mode",
    "json",
    "--no-approve",
    "--provider",
    upstream,
    "--model",
    `${upstream}/${input.model}`,
    "--thinking",
    input.effort,
    input.resume ? "--session" : "--session-id",
    input.sessionId,
    "--session-dir",
    input.sessionDir,
    "--tools",
    [...PI_READ_TOOL_NAMES, ...(hasAnswerTool ? [PI_ANSWER_TOOL_NAME] : [])].join(","),
    ...guardStartArgs(limitsPath, files.guardFile),
    ...(hasAnswerTool ? ["-e", files.answerFile, "--tasker-answer-schema", schemaPath] : []),
  ];
}
