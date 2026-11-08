import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PI_ANSWER_TOOL_NAME } from "../../../src/assistant/pi/answer-tool.js";
import { planAnswerJsonSchema } from "../../../src/plan/answer.js";
import { reviewAnswerJsonSchema } from "../../../src/review/answer.js";
import { thrownBy } from "../../helpers/errors.js";
import { useTempDir } from "../../helpers/temp.js";
import answerExtension from "../../../src/assistant/pi/answer-extension.js";
import { useFakePiExtension } from "../../helpers/fake-pi-extension.js";

function loadAnswerExtension(schemaPath: string) {
  const extension = useFakePiExtension();
  const previousArgv = process.argv;
  process.argv = [...previousArgv, "--tasker-answer-schema", schemaPath];
  try {
    answerExtension(extension.pi);
  } finally {
    process.argv = previousArgv;
  }
  return extension;
}

function writeSchema(schema: unknown): string {
  const path = join(useTempDir("tasker-pi-answer-schema-"), "schema.json");
  writeFileSync(path, JSON.stringify(schema));
  return path;
}

function toolOf(extension: ReturnType<typeof useFakePiExtension>) {
  return extension.pi.getAllTools().find((tool) => tool.name === PI_ANSWER_TOOL_NAME)!;
}

describe("answerExtension", () => {
  it("reads the schema flag and registers submit_answer with plan parameters", () => {
    const path = writeSchema(planAnswerJsonSchema());
    const extension = loadAnswerExtension(path);

    expect(extension.registeredFlags()).toContain("tasker-answer-schema");
    expect(extension.registeredFlagOptions()["tasker-answer-schema"]).toMatchObject({ type: "string" });
    expect(toolOf(extension)).toMatchObject({ name: PI_ANSWER_TOOL_NAME, parameters: planAnswerJsonSchema() });
  });

  it("uses review parameters", () => {
    const extension = loadAnswerExtension(writeSchema(reviewAnswerJsonSchema()));

    expect(toolOf(extension)).toMatchObject({ parameters: reviewAnswerJsonSchema() });
  });

  it("rejects an unreadable schema without exposing file contents", () => {
    const error = thrownBy(() => loadAnswerExtension("/missing/private-schema.json"));

    expect(String(error)).toContain("cannot read its schema file");
    expect(String(error)).not.toContain("private");
  });

  it("rejects a schema that is not an object without exposing file contents", () => {
    const path = writeSchema(["private schema"]);
    const error = thrownBy(() => loadAnswerExtension(path));

    expect(String(error)).toContain("schema is not a JSON object");
    expect(String(error)).not.toContain("private schema");
    expect(readFileSync(path, "utf8")).toContain("private schema");
  });

  it("accepts a structured answer and terminates the run", async () => {
    const extension = loadAnswerExtension(writeSchema(reviewAnswerJsonSchema()));
    const result = (await extension.callTool("submit_answer", { findings: [] })) as {
      content: { type: string; text: string }[];
      terminate?: boolean;
    };

    expect(result.content).toEqual([{ type: "text", text: "Answer accepted." }]);
    expect(result.terminate).toBe(true);
  });

  it("adds the tasker-answer system prompt section", async () => {
    const extension = loadAnswerExtension(writeSchema(planAnswerJsonSchema()));
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };

    await extension.dispatch("before_agent_start", event);

    expect(event.systemPromptOptions.sections["tasker-answer"]).toBe(
      `Call ${PI_ANSWER_TOOL_NAME} one time, as the last action.\n` +
        "After three rejected calls, the tool goes away.\n" +
        "With no tool, end the reply with the answer as one JSON object in a fenced json block.",
    );
  });

  it("hides the answer tool after three rejected top-level calls", async () => {
    const extension = loadAnswerExtension(writeSchema(reviewAnswerJsonSchema()));
    const event = { type: "tool_execution_end", toolName: PI_ANSWER_TOOL_NAME, isError: true };

    for (let count = 0; count < 3; count += 1) await extension.dispatch("tool_execution_end", event);

    expect(toolOf(extension)).toMatchObject({ name: PI_ANSWER_TOOL_NAME, exposure: "hidden" });
  });

  it("does not count a rejected nested call", async () => {
    const extension = loadAnswerExtension(writeSchema(reviewAnswerJsonSchema()));
    await extension.dispatch("tool_execution_end", {
      type: "tool_execution_end",
      toolName: PI_ANSWER_TOOL_NAME,
      isError: true,
      parentToolCallId: "parent-1",
    });

    expect(toolOf(extension)).not.toMatchObject({ exposure: "hidden" });
  });
});
