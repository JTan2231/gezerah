import { ApiError } from "../api/client";

export class SiteToolUsageError extends Error {}

export type SiteToolRegistrationState =
  | { status: "unsupported"; registeredToolNames: []; failedToolNames: [] }
  | { status: "unavailable"; registeredToolNames: []; failedToolNames: [] }
  | {
      status: "registering";
      registeredToolNames: string[];
      failedToolNames: string[];
    }
  | {
      status: "ready";
      registeredToolNames: string[];
      failedToolNames: [];
    }
  | {
      status: "failed";
      registeredToolNames: string[];
      failedToolNames: string[];
    };

interface SiteToolRegistrationResult {
  registeredToolNames: string[];
  failedToolNames: string[];
  aborted: boolean;
}

export function siteToolsSupported(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.modelContext?.registerTool === "function"
  );
}

export async function registerSiteTools(
  modelContext: ModelContext,
  tools: ModelContextTool[],
  signal: AbortSignal,
  recoveryInstruction: string,
): Promise<SiteToolRegistrationResult> {
  const registeredToolNames: string[] = [];
  const failedToolNames: string[] = [];
  let surfaceReady = false;
  for (const tool of tools) {
    if (signal.aborted)
      return { registeredToolNames, failedToolNames, aborted: true };
    try {
      await modelContext.registerTool(
        {
          ...tool,
          execute: async (input, options) => {
            if (toolCallAborted(signal, options?.signal))
              throw new DOMException(
                "The site-tool page changed.",
                "AbortError",
              );
            try {
              if (!surfaceReady)
                throw new SiteToolUsageError(
                  "The complete site-tool surface is not ready.",
                );
              return await tool.execute(input, options);
            } catch (reason) {
              if (toolCallAborted(signal, options?.signal))
                throw new DOMException(
                  "The tool call was cancelled.",
                  "AbortError",
                );
              if (reason instanceof ApiError)
                return {
                  ok: false,
                  error: {
                    code: reason.code,
                    message: reason.message,
                    fields: reason.fields,
                  },
                  next_step: recoveryInstruction,
                };
              if (reason instanceof SiteToolUsageError)
                return {
                  ok: false,
                  error: { code: "tool_usage_error", message: reason.message },
                  next_step: recoveryInstruction,
                };
              throw reason;
            }
          },
        },
        { signal },
      );
      registeredToolNames.push(tool.name);
    } catch {
      failedToolNames.push(tool.name);
    }
  }
  surfaceReady =
    !signal.aborted &&
    failedToolNames.length === 0 &&
    registeredToolNames.length === tools.length;
  return { registeredToolNames, failedToolNames, aborted: signal.aborted };
}

export function completeSiteToolRegistration(
  controller: AbortController,
  result: SiteToolRegistrationResult,
  expectedToolCount: number,
): SiteToolRegistrationState | null {
  if (result.aborted) return null;
  if (
    result.failedToolNames.length === 0 &&
    result.registeredToolNames.length === expectedToolCount
  )
    return {
      status: "ready",
      registeredToolNames: result.registeredToolNames,
      failedToolNames: [],
    };

  // Registrations live until their shared signal aborts. Tear down every
  // partial registration so a failed surface cannot look usable.
  controller.abort();
  return {
    status: "failed",
    registeredToolNames: result.registeredToolNames,
    failedToolNames: result.failedToolNames,
  };
}

function toolCallAborted(
  registrationSignal: AbortSignal,
  invocationSignal: AbortSignal | undefined,
): boolean {
  return registrationSignal.aborted || invocationSignal?.aborted === true;
}
