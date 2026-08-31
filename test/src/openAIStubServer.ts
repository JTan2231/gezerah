import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

const TERRA_MODEL = "gpt-5.6-terra";
const LUNA_MODEL = "gpt-5.6-luna";
export const TERRA_MODEL_FAILURE_MARKER = "[[E2E_TERRA_MODEL_FAILURE]]";

export interface TestOpenAIStubServer {
  baseURL: string;
  stop: () => Promise<void>;
}

interface ResponsesRequest {
  model: string;
  instructions?: string;
  input: string;
}

interface CompilerContext {
  world: { name: string; world_brief?: string };
  mechanics: {
    ref: string;
    source_kind: string;
    value_kind: string;
  }[];
  entities: {
    ref: string;
    profile: { label: string; value: string }[];
    active_status_instances: { ref: string; description?: string }[];
  }[];
  current_problem?: { actions: { ref: string }[] };
  recent_history: { problem: string; consequence: string }[];
}

export async function startTestOpenAIStubServer(): Promise<TestOpenAIStubServer> {
  let responseNumber = 0;
  const server = createServer((request, response) => {
    void handleResponsesRequest(request, response, ++responseNumber).catch(
      (error: unknown) => {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              type: "e2e_model_error",
              code: "e2e_model_error",
              message: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      },
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      }),
  };
}

async function handleResponsesRequest(
  request: IncomingMessage,
  response: ServerResponse,
  responseNumber: number,
) {
  if (request.method !== "POST" || request.url !== "/v1/responses") {
    response.writeHead(404).end();
    return;
  }
  const body = (await readJSON(request)) as ResponsesRequest;
  let text: string;
  if (body.model === LUNA_MODEL) {
    text = JSON.stringify(compileConsequence(body.input));
  } else if (body.model === TERRA_MODEL) {
    if (
      !body.instructions?.includes("next problem") &&
      body.input.includes(TERRA_MODEL_FAILURE_MARKER)
    ) {
      throw new Error("forced Terra consequence failure");
    }
    text = body.instructions?.includes("next problem")
      ? "The tide rises around the next crossing."
      : "The party reaches safety, though the crossing leaves its mark.";
  } else {
    throw new Error(`unexpected model ${body.model}`);
  }
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(
    JSON.stringify({
      id: `resp_e2e_${responseNumber}`,
      model: body.model,
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text }],
        },
      ],
    }),
  );
}

function compileConsequence(input: string) {
  const envelope = JSON.parse(input) as {
    authoritative_context: CompilerContext;
    consequence_narrative: string;
  };
  const context = envelope.authoritative_context;
  const narrative = envelope.consequence_narrative;
  const entity = context.entities[0];
  const mechanic = context.mechanics.find(
    (candidate) =>
      candidate.source_kind === "input" && candidate.value_kind === "number",
  );
  if (entity === undefined || mechanic === undefined)
    throw new Error("e2e consequence context has no numeric entity target");
  if (context.world.world_brief === undefined || entity.profile.length < 2)
    throw new Error(
      "e2e consequence context is missing its World or Entity profile",
    );

  const run = context.world.name.split(" ").at(-1);
  if (run === undefined) throw new Error("e2e world name has no run suffix");
  const effects: Record<string, unknown>[] = [];
  if (narrative.includes("loses twenty bearing")) {
    effects.push(adjustEffect(entity.ref, mechanic.ref, "-20"));
  } else if (narrative.includes("tears at every footing")) {
    effects.push(adjustEffect(entity.ref, mechanic.ref, "-2"));
    effects.push(
      applyStatusEffectRequest(
        entity.ref,
        mechanic.ref,
        `Off Balance ${run}`,
        `The first crossing left a visible stagger ${run}.`,
        "1",
      ),
    );
  } else if (narrative.includes("second gust settles")) {
    if (context.recent_history.length !== 1)
      throw new Error("second consequence did not receive one history pair");
    effects.push(
      applyStatusEffectRequest(
        entity.ref,
        mechanic.ref,
        `Off Balance ${run}`,
        `A separate gust caused another stagger ${run}.`,
        "2",
      ),
    );
  } else if (narrative.includes("first stagger ends")) {
    if (context.recent_history.length !== 2)
      throw new Error("third consequence did not receive two history pairs");
    const target = entity.active_status_instances.find((status) =>
      status.description?.includes("first crossing"),
    );
    if (target === undefined)
      throw new Error("e2e consequence context has no first status instance");
    effects.push(removeStatusEffectRequest(entity.ref, target.ref));
  }

  return {
    selected_action_ref: context.current_problem?.actions[0]?.ref ?? null,
    action_summary: null,
    effects,
  };
}

function emptyEffect(type: string, entityRef: string) {
  return {
    type,
    entity_ref: entityRef,
    mechanic_ref: null,
    status_instance_ref: null,
    value_kind: null,
    number_value: null,
    boolean_value: null,
    amount: null,
    status_name: null,
    status_description: null,
    modifiers: [] as Record<string, unknown>[],
  };
}

function adjustEffect(entityRef: string, mechanicRef: string, amount: string) {
  return {
    ...emptyEffect("adjust-number", entityRef),
    mechanic_ref: mechanicRef,
    amount,
  };
}

function applyStatusEffectRequest(
  entityRef: string,
  mechanicRef: string,
  name: string,
  description: string,
  amount: string,
) {
  return {
    ...emptyEffect("apply-status", entityRef),
    status_name: name,
    status_description: description,
    modifiers: [
      {
        mechanic_ref: mechanicRef,
        operation: "add-number",
        value_kind: "number",
        number_value: amount,
        boolean_value: null,
      },
    ],
  };
}

function removeStatusEffectRequest(
  entityRef: string,
  statusInstanceRef: string,
) {
  return {
    ...emptyEffect("remove-status", entityRef),
    status_instance_ref: statusInstanceRef,
  };
}

async function readJSON(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
