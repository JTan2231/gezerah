interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
  };
  execute: (
    input: unknown,
    options?: { signal?: AbortSignal },
  ) => Promise<unknown>;
}

interface ModelContext {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

interface Document {
  modelContext?: ModelContext;
}
