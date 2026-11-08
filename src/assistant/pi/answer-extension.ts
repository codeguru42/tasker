import { readFileSync } from "node:fs";
import { PI_ANSWER_TOOL_NAME } from "./answer-tool.js";

interface ToolResult {
  content: { type: "text"; text: string }[];
  details: unknown;
  isError?: boolean;
  terminate?: boolean;
}

interface ToolDefinition {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden";
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: (result: ToolResult) => void,
    ctx: Record<string, unknown>,
  ): Promise<ToolResult>;
}

interface AnswerExtensionApi {
  registerFlag(name: string, options: { description?: string; type: "string"; default?: string }): void;
  registerTool(tool: ToolDefinition): void;
  on(
    event: "before_agent_start",
    handler: (
      event: {
        prompt: string;
        readonly systemPrompt: string;
        systemPromptOptions: { sections: Record<string, string> };
      },
      ctx: Record<string, unknown>,
    ) => unknown,
  ): void;
  on(
    event: "tool_execution_end",
    handler: (event: {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
      durationMs?: number;
      parentToolCallId?: string;
    }) => unknown,
  ): void;
}

const FLAG = "--tasker-answer-schema";

export default function answerExtension(pi: AnswerExtensionApi): void {
  pi.registerFlag("tasker-answer-schema", {
    description: "Path to the JSON Schema for the tasker answer tool",
    type: "string",
  });

  const flagIndex = process.argv.indexOf(FLAG);
  const schemaPath = flagIndex < 0 ? undefined : process.argv[flagIndex + 1];
  if (!schemaPath) throw new Error(`the answer extension needs a path after ${FLAG}`);

  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8")) as unknown;
  } catch {
    throw new Error("the answer extension cannot read its schema file");
  }
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error("the answer extension schema is not a JSON object");
  }

  const tool: ToolDefinition = {
    name: PI_ANSWER_TOOL_NAME,
    label: "Submit answer",
    description: "Submit the structured plan or review answer.",
    parameters: schema as Record<string, unknown>,
    async execute() {
      return {
        content: [{ type: "text", text: "Answer accepted." }],
        details: {},
        terminate: true,
      };
    },
  };
  pi.registerTool(tool);
  pi.on("before_agent_start", (event) => {
    event.systemPromptOptions.sections["tasker-answer"] =
      `Call ${PI_ANSWER_TOOL_NAME} one time, as the last action.\n` +
      "After three rejected calls, the tool goes away.\n" +
      "With no tool, end the reply with the answer as one JSON object in a fenced json block.";
  });

  let rejectedTopLevelCalls = 0;
  pi.on("tool_execution_end", (event) => {
    if (event.toolName !== PI_ANSWER_TOOL_NAME || !event.isError || event.parentToolCallId !== undefined) return;
    rejectedTopLevelCalls += 1;
    if (rejectedTopLevelCalls === 3) pi.registerTool({ ...tool, exposure: "hidden" });
  });
}
