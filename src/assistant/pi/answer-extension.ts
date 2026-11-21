import { readFileSync } from "node:fs";
import { errorMessage } from "../../error-message.js";
import { packagePath } from "../../package-path.js";
import { fillTemplate } from "../../prompts/template.js";
import { readPromptTemplate } from "../../prompts/template-file.js";
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

export const ANSWER_SECTION_PATH = packagePath("prompt-templates/pi/answer-section.md");

export default function answerExtension(pi: AnswerExtensionApi): void {
  createAnswerExtension(ANSWER_SECTION_PATH)(pi);
}

export function createAnswerExtension(templatePath: string): (pi: AnswerExtensionApi) => void {
  return (pi) => {
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

    let body: string;
    try {
      body = readPromptTemplate(templatePath).body;
    } catch (error) {
      throw new Error(`the answer extension cannot read its template file: ${errorMessage(error)}`, { cause: error });
    }
    const section = fillTemplate("pi/answer-section", body, { ANSWER_TOOL: PI_ANSWER_TOOL_NAME });

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
      event.systemPromptOptions.sections["tasker-answer"] = section;
    });

    let rejectedTopLevelCalls = 0;
    pi.on("tool_execution_end", (event) => {
      if (event.toolName !== PI_ANSWER_TOOL_NAME || !event.isError || event.parentToolCallId !== undefined) return;
      rejectedTopLevelCalls += 1;
      if (rejectedTopLevelCalls === 3) pi.registerTool({ ...tool, exposure: "hidden" });
    });
  };
}
