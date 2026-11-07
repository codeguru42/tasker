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

export interface FakePiExtensionApi {
  on(event: string, handler: FakePiEventHandler): void;
  registerFlag(name: string, description: string): void;
  getFlag(name: string): string | undefined;
  registerTool(tool: FakePiTool): void;
  getAllTools(): FakePiTool[];
}

export interface FakePiExtension {
  pi: FakePiExtensionApi;
  dispatch(event: string, data: unknown, context?: Partial<FakePiContext>): Promise<unknown[]>;
  callTool(name: string, input: unknown, context?: Partial<FakePiContext>): Promise<unknown>;
  registeredFlags(): string[];
}

export function useFakePiExtension(
  initialTools: readonly FakePiTool[] = [],
  flags: Record<string, string> = {},
): FakePiExtension {
  const handlers = new Map<string, FakePiEventHandler[]>();
  const registered = new Map<string, string>();
  const tools = new Map<string, FakePiTool>();
  for (const tool of initialTools) tools.set(tool.name, tool);

  const pi: FakePiExtensionApi = {
    on(event, handler) {
      const eventHandlers = handlers.get(event) ?? [];
      eventHandlers.push(handler);
      handlers.set(event, eventHandlers);
    },
    registerFlag(name, description) {
      registered.set(name, description);
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

  return { pi, dispatch, callTool, registeredFlags: () => [...registered.keys()] };
}
