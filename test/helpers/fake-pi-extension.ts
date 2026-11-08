export interface FakePiTool {
  name: string;
  label?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden";
  sourceInfo: { path: string; source: string };
  execute(input: unknown, context: FakePiContext): unknown;
}

export interface FakePiAnswerTool {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  exposure?: "direct" | "model-only" | "codemode" | "deferred" | "hidden";
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: (result: unknown) => void,
    context: FakePiContext,
  ): Promise<unknown>;
}

export interface FakePiContext {
  executeTool(name: string, input: unknown): Promise<unknown>;
  [key: string]: unknown;
}

export type FakePiEventHandler = (event: unknown, context: FakePiContext) => unknown;

interface FakePiEvents {
  tool_call: unknown;
  before_agent_start: {
    prompt: string;
    readonly systemPrompt: string;
    systemPromptOptions: { sections: Record<string, string> };
  };
  tool_execution_end: {
    type: "tool_execution_end";
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
    durationMs?: number;
    parentToolCallId?: string;
  };
}

type FakePiEvent<K extends string> = K extends keyof FakePiEvents ? FakePiEvents[K] : unknown;

export type FakePiFlagOptions =
  { description?: string; type: "string"; default?: string } | { description: string; type: "boolean" };

export interface FakePiExtensionApi {
  on<K extends string>(event: K, handler: (event: FakePiEvent<K>, context: FakePiContext) => unknown): void;
  registerFlag(name: string, options: FakePiFlagOptions): void;
  getFlag(name: string): string | undefined;
  registerTool(tool: FakePiTool | FakePiAnswerTool): void;
  getAllTools(): FakePiTool[];
}

export interface FakePiExtension {
  pi: FakePiExtensionApi;
  dispatch(event: string, data: unknown, context?: Partial<FakePiContext>): Promise<unknown[]>;
  callTool(name: string, input: unknown, context?: Partial<FakePiContext>): Promise<unknown>;
  registeredFlags(): string[];
  registeredFlagOptions(): Record<string, FakePiFlagOptions>;
}

export function useFakePiExtension(
  initialTools: readonly FakePiTool[] = [],
  flags: Record<string, string> = {},
): FakePiExtension {
  const handlers = new Map<string, FakePiEventHandler[]>();
  const registered = new Map<string, FakePiFlagOptions>();
  const tools = new Map<string, FakePiTool>();
  for (const tool of initialTools) tools.set(tool.name, tool);

  const pi: FakePiExtensionApi = {
    on<K extends string>(event: K, handler: (event: FakePiEvent<K>, context: FakePiContext) => unknown) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler as FakePiEventHandler);
      handlers.set(event, eventHandlers);
    },
    registerFlag(name, options) {
      registered.set(name, options);
    },
    getFlag(name) {
      return registered.has(name) ? flags[name] : undefined;
    },
    registerTool(tool) {
      tools.set(tool.name, tool as FakePiTool);
    },
    getAllTools() {
      return [...tools.values()];
    },
  };

  const dispatch = async (event: string, data: unknown, context: Partial<FakePiContext> = {}): Promise<unknown[]> => {
    const eventContext = context as FakePiContext;
    const results: unknown[] = [];
    for (const handler of handlers.get(event) ?? []) {
      results.push(await handler(data, eventContext));
    }
    return results;
  };

  const callTool = async (name: string, input: unknown, context: Partial<FakePiContext> = {}): Promise<unknown> => {
    const eventContext: FakePiContext = {
      ...context,
      executeTool: (nestedName, nestedInput) => callTool(nestedName, nestedInput, context),
    };
    const outcomes = await dispatch("tool_call", { toolName: name, input }, eventContext);
    const block = outcomes.find((outcome) => {
      return outcome !== null && typeof outcome === "object" && "block" in outcome && outcome.block === true;
    });
    if (block !== undefined) return block;

    const tool = tools.get(name);
    if (!tool) throw new Error(`fake pi: unknown tool ${name}`);
    if (name === "submit_answer") {
      const execute = tool.execute.bind(tool);
      return Reflect.apply(execute, undefined, ["fake-tool-call", input, undefined, undefined, eventContext]);
    }
    return tool.execute(input, eventContext);
  };

  return {
    pi,
    dispatch,
    callTool,
    registeredFlags: () => [...registered.keys()],
    registeredFlagOptions: () => Object.fromEntries(registered),
  };
}
