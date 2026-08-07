import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody, sanitizeURL } from "../../src/scenario";

type TaggedValue =
  { kind: "number"; value: number } | { kind: "boolean"; value: boolean };

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  rules_revision: number;
}

interface Expression {
  operation: string;
  mechanic_id?: string;
  value?: TaggedValue;
  operands?: Expression[];
}

interface MechanicResponse extends IdentifiedResource {
  name: string;
  source_kind: "input" | "derived";
  expression?: Expression;
}

interface MechanicMutationResponse {
  revision: number;
  mechanic: MechanicResponse;
}

interface MechanicCollectionResponse {
  revision: number;
  mechanics: MechanicResponse[];
}

interface AppliedModifier {
  status_instance_id: string;
  status_name: string;
  operation: string;
  operand: TaggedValue;
  before: TaggedValue;
  after: TaggedValue;
}

interface StateResponse {
  revision: number;
  status_revision: number;
  rules_revision: number;
  values: Record<string, TaggedValue>;
  effective_values: Record<string, TaggedValue>;
  evaluations: Record<
    string,
    {
      source_kind: "input" | "derived";
      presence: "stored" | "defaulted" | "derived";
      intrinsic: TaggedValue;
      effective: TaggedValue;
      modifiers: AppliedModifier[];
    }
  >;
  active_statuses: Array<{
    id: string;
    name: string;
    description?: string;
    source_interaction_id: string;
    source_resolution_id?: string;
    source_effect_id: string;
  }>;
}

interface EntityResponse extends IdentifiedResource {
  state: StateResponse;
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
}

interface AppliedEffect {
  type: "set" | "adjust-number" | "apply-status" | "remove-status";
  effect_id: string;
  entity_id: string;
  status_instance_id?: string;
  status_name?: string;
  active_before?: boolean;
  active_after?: boolean;
  changed: boolean;
}

interface EffectiveChange {
  entity_id: string;
  mechanic_id: string;
  before: TaggedValue;
  after: TaggedValue;
}

interface ResolutionResult {
  preview?: boolean;
  replayed?: boolean;
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  applied_effects: AppliedEffect[];
  effective_changes: EffectiveChange[];
  state: { records: Record<string, StateResponse> };
}

test("contract: typed rules publish atomically and statuses change effective state with receipts", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await postJSON<IdentifiedResource>(
    request,
    `${baseURL}/api/users`,
    { display_name: `Graph Author ${unique}` },
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Calculated Coast ${unique}` },
    owner.id,
  );
  expect(world.rules_revision).toBe(0);

  const inputMutation = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    {
      kind: "capacity",
      mode: "score",
      source_kind: "input",
      name: "Vigor",
      minimum: 0,
      maximum: 20,
      step: 1,
      default_number: 10,
      mutable_during_play: true,
      archived: false,
      expected_rules_revision: world.rules_revision,
    },
    owner.id,
  );
  expect(inputMutation).toMatchObject({
    revision: 1,
    mechanic: { name: "Vigor", source_kind: "input" },
  });
  const vigor = inputMutation.mechanic;

  const derivedRequest = {
    kind: "capacity",
    mode: "score",
    source_kind: "derived",
    name: "Impact",
    mutable_during_play: false,
    archived: false,
    expected_rules_revision: inputMutation.revision,
    expression: {
      operation: "multiply-number",
      operands: [
        { operation: "mechanic-reference", mechanic_id: vigor.id },
        { operation: "literal", value: numberValue(2) },
      ],
    },
  };
  const derivedMutation = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    derivedRequest,
    owner.id,
  );
  expect(derivedMutation).toMatchObject({
    revision: 2,
    mechanic: {
      name: "Impact",
      source_kind: "derived",
      expression: { operation: "multiply-number" },
    },
  });
  const impact = derivedMutation.mechanic;

  const cyclePublication = await request.put(
    `${baseURL}/api/worlds/${world.id}/mechanics/${impact.id}`,
    {
      headers: identityHeaders(owner.id),
      data: {
        ...derivedRequest,
        expected_rules_revision: derivedMutation.revision,
        expression: {
          operation: "mechanic-reference",
          mechanic_id: impact.id,
        },
      },
    },
  );
  const cycleError = await expectAPIError(
    cyclePublication,
    422,
    "validation_failed",
  );
  expect(JSON.stringify(cycleError)).toContain("cycle");
  await expectPublishedRules(
    request,
    baseURL,
    world.id,
    owner.id,
    derivedMutation.revision,
    impact.id,
    "multiply-number",
  );

  const invalidTypePublication = await request.put(
    `${baseURL}/api/worlds/${world.id}/mechanics/${impact.id}`,
    {
      headers: identityHeaders(owner.id),
      data: {
        ...derivedRequest,
        expected_rules_revision: derivedMutation.revision,
        expression: {
          operation: "and",
          operands: [
            { operation: "mechanic-reference", mechanic_id: vigor.id },
            { operation: "literal", value: booleanValue(true) },
          ],
        },
      },
    },
  );
  const typeError = await expectAPIError(
    invalidTypePublication,
    422,
    "validation_failed",
  );
  expect(JSON.stringify(typeError)).toContain("boolean");
  await expectPublishedRules(
    request,
    baseURL,
    world.id,
    owner.id,
    derivedMutation.revision,
    impact.id,
    "multiply-number",
  );

  const rulesRevision = derivedMutation.revision;

  const entity = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: "Ilya Stone" },
    owner.id,
  );
  expect(entity.state.values).toEqual({ [vigor.id]: numberValue(10) });
  expect(entity.state.effective_values).toMatchObject({
    [vigor.id]: numberValue(10),
    [impact.id]: numberValue(20),
  });

  const authoredState =
    await test.step("CCY-V03 rejects a stale state/rules save and accepts the authoritative retry", async () => {
      const staleStateWrite = await request.put(
        `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
        {
          headers: identityHeaders(owner.id),
          data: {
            expected_revision: entity.state.revision,
            expected_rules_revision: rulesRevision - 1,
            values: { [vigor.id]: numberValue(6) },
          },
        },
      );
      await expectAPIError(staleStateWrite, 409, "revision_conflict");

      const result = await putJSON<StateResponse>(
        request,
        `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
        {
          expected_revision: entity.state.revision,
          expected_rules_revision: rulesRevision,
          values: { [vigor.id]: numberValue(6) },
        },
        owner.id,
      );
      expect(result).toMatchObject({
        revision: 1,
        status_revision: 0,
        rules_revision: rulesRevision,
        values: { [vigor.id]: numberValue(6) },
        effective_values: {
          [vigor.id]: numberValue(6),
          [impact.id]: numberValue(12),
        },
        evaluations: {
          [vigor.id]: {
            source_kind: "input",
            presence: "stored",
            intrinsic: numberValue(6),
            effective: numberValue(6),
            modifiers: [],
          },
          [impact.id]: {
            source_kind: "derived",
            presence: "derived",
            intrinsic: numberValue(12),
            effective: numberValue(12),
            modifiers: [],
          },
        },
      });
      expect(Object.keys(result.values)).toEqual([vigor.id]);
      return result;
    });

  const applyInteraction = await createAdjudicatingInteraction(
    request,
    baseURL,
    world.id,
    entity.id,
    owner.id,
    `Apply status ${unique}`,
  );
  const applyEffectID = randomUUID();
  const applyPayload = {
    expected_revision: applyInteraction.revision,
    expected_rules_revision: rulesRevision,
    narrative: "The long climb leaves Ilya weakened.",
    effects: [
      {
        id: applyEffectID,
        type: "apply-status",
        targets: [{ entity_id: entity.id }],
        status: {
          name: "Weakened",
          description:
            "Vigor is reduced while this consequence remains active.",
          modifiers: [
            {
              mechanic_id: vigor.id,
              operation: "add-number",
              value: numberValue(-2),
              priority: 10,
            },
          ],
        },
      },
    ],
  };

  const stalePreview = await request.post(
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/preview`,
    {
      headers: identityHeaders(owner.id),
      data: { ...applyPayload, expected_rules_revision: rulesRevision - 1 },
    },
  );
  await expectAPIError(stalePreview, 409, "revision_conflict");

  const applyPreview = await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/preview`,
    applyPayload,
    owner.id,
  );
  expect(applyPreview).toMatchObject({
    preview: true,
    interaction_id: applyInteraction.id,
    interaction_revision: applyInteraction.revision,
    rules_revision: rulesRevision,
    applied_effects: [
      {
        type: "apply-status",
        effect_id: applyEffectID,
        entity_id: entity.id,
        status_name: "Weakened",
        active_before: false,
        active_after: true,
        changed: true,
      },
    ],
  });
  expect(applyPreview.applied_effects[0]?.status_instance_id).toBeTruthy();
  expect(applyPreview.effective_changes).toEqual(
    expect.arrayContaining([
      effectiveChange(entity.id, vigor.id, 6, 4),
      effectiveChange(entity.id, impact.id, 12, 8),
    ]),
  );
  expect(applyPreview.state.records[entity.id]?.active_statuses).toMatchObject([
    {
      name: "Weakened",
      description: "Vigor is reduced while this consequence remains active.",
      source_interaction_id: applyInteraction.id,
      source_effect_id: applyEffectID,
    },
  ]);

  const stateAfterPreview = await getJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
    owner.id,
  );
  expect(stateAfterPreview).toMatchObject({
    revision: authoredState.revision,
    status_revision: 0,
    active_statuses: [],
  });

  const applyIdempotencyKey = randomUUID();
  const applyResult = await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
    { ...applyPayload, idempotency_key: applyIdempotencyKey },
    owner.id,
  );
  expect(applyResult).toMatchObject({
    interaction_id: applyInteraction.id,
    interaction_revision: applyInteraction.revision + 1,
    rules_revision: rulesRevision,
    applied_effects: [
      {
        type: "apply-status",
        effect_id: applyEffectID,
        entity_id: entity.id,
        status_name: "Weakened",
        active_before: false,
        active_after: true,
        changed: true,
      },
    ],
  });
  expect(applyResult.effective_changes).toEqual(
    expect.arrayContaining([
      effectiveChange(entity.id, vigor.id, 6, 4),
      effectiveChange(entity.id, impact.id, 12, 8),
    ]),
  );

  const replayedApply = await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
    { ...applyPayload, idempotency_key: applyIdempotencyKey },
    owner.id,
  );
  expect(replayedApply).toMatchObject({
    replayed: true,
    interaction_id: applyResult.interaction_id,
    interaction_revision: applyResult.interaction_revision,
    applied_effects: applyResult.applied_effects,
  });
  await expectAPIError(
    await request.post(
      `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
      {
        headers: identityHeaders(owner.id),
        data: {
          ...applyPayload,
          narrative: `${applyPayload.narrative} changed`,
          idempotency_key: applyIdempotencyKey,
        },
      },
    ),
    409,
    "idempotency_conflict",
  );

  const weakenedState = await getJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
    owner.id,
  );
  expect(weakenedState).toMatchObject({
    revision: authoredState.revision,
    status_revision: 1,
    rules_revision: rulesRevision,
    values: { [vigor.id]: numberValue(6) },
    effective_values: {
      [vigor.id]: numberValue(4),
      [impact.id]: numberValue(8),
    },
    active_statuses: [
      {
        name: "Weakened",
        description: "Vigor is reduced while this consequence remains active.",
        source_interaction_id: applyInteraction.id,
        source_effect_id: applyEffectID,
      },
    ],
    evaluations: {
      [vigor.id]: {
        source_kind: "input",
        presence: "stored",
        intrinsic: numberValue(6),
        effective: numberValue(4),
        modifiers: [
          {
            status_name: "Weakened",
            operation: "add-number",
            operand: numberValue(-2),
            before: numberValue(6),
            after: numberValue(4),
          },
        ],
      },
      [impact.id]: {
        source_kind: "derived",
        presence: "derived",
        intrinsic: numberValue(8),
        effective: numberValue(8),
        modifiers: [],
      },
    },
  });

  const weakenedInstance = weakenedState.active_statuses[0];
  expect(weakenedInstance).toBeDefined();
  if (weakenedInstance === undefined) {
    throw new Error("resolved consequence did not create a status instance");
  }
  const weakenedInstanceID = weakenedInstance.id;

  const removeInteraction = await createAdjudicatingInteraction(
    request,
    baseURL,
    world.id,
    entity.id,
    owner.id,
    `Remove status ${unique}`,
  );
  const removeEffectID = randomUUID();
  const removePayload = {
    expected_revision: removeInteraction.revision,
    expected_rules_revision: rulesRevision,
    narrative: "A night's rest restores Ilya's vigor.",
    effects: [
      {
        id: removeEffectID,
        type: "remove-status",
        targets: [
          {
            entity_id: entity.id,
            status_instance_id: weakenedInstanceID,
          },
        ],
      },
    ],
  };
  const removePreview = await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${removeInteraction.id}/preview`,
    removePayload,
    owner.id,
  );
  expect(removePreview.applied_effects).toMatchObject([
    {
      type: "remove-status",
      effect_id: removeEffectID,
      entity_id: entity.id,
      status_instance_id: weakenedInstanceID,
      status_name: "Weakened",
      active_before: true,
      active_after: false,
      changed: true,
    },
  ]);
  expect(removePreview.effective_changes).toEqual(
    expect.arrayContaining([
      effectiveChange(entity.id, vigor.id, 4, 6),
      effectiveChange(entity.id, impact.id, 8, 12),
    ]),
  );

  const removeResult = await postJSON<ResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${removeInteraction.id}/resolve`,
    { ...removePayload, idempotency_key: randomUUID() },
    owner.id,
  );
  expect(removeResult).toMatchObject({
    interaction_id: removeInteraction.id,
    interaction_revision: removeInteraction.revision + 1,
    rules_revision: rulesRevision,
    applied_effects: [
      {
        type: "remove-status",
        effect_id: removeEffectID,
        entity_id: entity.id,
        status_instance_id: weakenedInstanceID,
        status_name: "Weakened",
        active_before: true,
        active_after: false,
        changed: true,
      },
    ],
  });
  expect(removeResult.effective_changes).toEqual(
    expect.arrayContaining([
      effectiveChange(entity.id, vigor.id, 4, 6),
      effectiveChange(entity.id, impact.id, 8, 12),
    ]),
  );

  const restoredState = await getJSON<StateResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/state`,
    owner.id,
  );
  expect(restoredState).toMatchObject({
    revision: authoredState.revision,
    status_revision: 2,
    rules_revision: rulesRevision,
    values: { [vigor.id]: numberValue(6) },
    effective_values: {
      [vigor.id]: numberValue(6),
      [impact.id]: numberValue(12),
    },
    active_statuses: [],
  });

  const competingInteraction = await createAdjudicatingInteraction(
    request,
    baseURL,
    world.id,
    entity.id,
    owner.id,
    `Competing resolution ${unique}`,
  );
  const competingPayload = {
    expected_revision: competingInteraction.revision,
    expected_rules_revision: rulesRevision,
    narrative: `Only one ruling wins ${unique}`,
    effects: [],
  };
  const competingResponses = await Promise.all([
    request.post(
      `${baseURL}/api/worlds/${world.id}/interactions/${competingInteraction.id}/resolve`,
      {
        headers: identityHeaders(owner.id),
        data: { ...competingPayload, idempotency_key: randomUUID() },
      },
    ),
    request.post(
      `${baseURL}/api/worlds/${world.id}/interactions/${competingInteraction.id}/resolve`,
      {
        headers: identityHeaders(owner.id),
        data: { ...competingPayload, idempotency_key: randomUUID() },
      },
    ),
  ]);
  expect(
    competingResponses.map((response) => response.status()).sort(),
  ).toEqual([200, 409]);
  const loser = competingResponses.find(
    (response) => response.status() === 409,
  );
  expect(loser).toBeDefined();
  await expectAPIError(
    loser as APIResponse,
    409,
    "interaction_lifecycle_conflict",
  );
});

async function expectPublishedRules(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  userID: string,
  revision: number,
  mechanicID: string,
  operation: string,
): Promise<void> {
  const collection = await getJSON<MechanicCollectionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    userID,
  );
  expect(collection.revision).toBe(revision);
  expect(
    collection.mechanics.find((mechanic) => mechanic.id === mechanicID),
  ).toMatchObject({ expression: { operation } });
}

async function createAdjudicatingInteraction(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  userID: string,
  prompt: string,
): Promise<InteractionResponse> {
  const open = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions`,
    {
      present: true,
      prompt,
      eligible_responder_membership_ids: [],
      entity_ids: [entityID],
    },
    userID,
  );
  expect(open).toMatchObject({ status: "open", revision: 1 });
  const adjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions/${open.id}/adjudicate`,
    { expected_revision: open.revision },
    userID,
  );
  expect(adjudicating).toMatchObject({ status: "adjudicating", revision: 2 });
  return adjudicating;
}

function numberValue(value: number): TaggedValue {
  return { kind: "number", value };
}

function booleanValue(value: boolean): TaggedValue {
  return { kind: "boolean", value };
}

function effectiveChange(
  entityID: string,
  mechanicID: string,
  before: number,
  after: number,
): EffectiveChange {
  return {
    entity_id: entityID,
    mechanic_id: mechanicID,
    before: numberValue(before),
    after: numberValue(after),
  };
}

function identityHeaders(userID: string): Record<string, string> {
  return { "X-DND-User-ID": userID };
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userID?: string,
): Promise<T> {
  const response = await request.get(url, {
    ...(userID === undefined ? {} : { headers: identityHeaders(userID) }),
  });
  return expectJSON<T>(response, url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await request.post(url, {
    data,
    ...(userID === undefined ? {} : { headers: identityHeaders(userID) }),
  });
  return expectJSON<T>(response, url);
}

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await request.put(url, {
    data,
    ...(userID === undefined ? {} : { headers: identityHeaders(userID) }),
  });
  return expectJSON<T>(response, url);
}

async function expectJSON<T>(response: APIResponse, url: string): Promise<T> {
  const body = await response.text();
  expect(
    response.ok(),
    `${response.status()} ${sanitizeURL(url)}: ${sanitizeDiagnosticBody(body)}`,
  ).toBe(true);
  return JSON.parse(body) as T;
}

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<unknown> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as { error?: { code?: string } };
  expect(decoded.error?.code).toBe(code);
  return decoded;
}
