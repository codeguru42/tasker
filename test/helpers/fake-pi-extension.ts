export interface FakePiTool {
  name: string;
  sourceInfo: { path: string; source: string };
  execute(input: unknown, context: FakePiContext): unknown;
}

export interface FakePiContext {
  executeTool(name: string, input: unknown): Promise<unknown>;
  [key: string]: unknown;
}

export type FakePiEventHandler = (event: unknown, context: FakePiContext) => unknown;

export type FakePiFlagOptions = { description: string; type: "string" } | { description: string; type: "boolean" };

export interface FakePiExtensionApi {
  on(event: string, handler: FakePiEventHandler): void;
  registerFlag(name: string, options: FakePiFlagOptions): void;
  getFlag(name: string): string | undefined;
  registerTool(tool: FakePiTool): void;
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
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerFlag(name, options) {
      registered.set(name, options);
    },
    getFlag(name) {
      return registered.has(name) ? flags[name] : undefined;
    },
    registerTool(tool) {
      tools.set(tool.name, tool);
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
