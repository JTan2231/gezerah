import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody, sanitizeURL } from "../../src/scenario";
import {
  actorMutationHeaders,
  actorRequest,
  disposeAuthenticatedActors,
  getAs,
  postAs,
  putAs,
  signupActor,
} from "../support/auth";

type DecimalText = string;

type MechanicValue =
  { kind: "number"; value: DecimalText } | { kind: "boolean"; value: boolean };

test.afterEach(async () => disposeAuthenticatedActors());

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  rules_revision: number;
}

interface Expression {
  operation: string;
  mechanic_id?: string;
  value?: MechanicValue;
  operands?: Expression[];
}

interface MechanicResponse extends IdentifiedResource {
  name: string;
  source_kind: "input" | "derived";
  minimum?: DecimalText;
  maximum?: DecimalText;
  step?: DecimalText;
  default_number?: DecimalText;
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
  operand: MechanicValue;
  before: MechanicValue;
  after: MechanicValue;
}

interface EntitySheetResponse {
  entity_id: string;
  logical_state_revision: number;
  status_set_revision: number;
  rules_revision: number;
  logical_input_values: Record<string, MechanicValue>;
  effective_values: Record<string, MechanicValue>;
  evaluations: Record<
    string,
    {
      source_kind: "input" | "derived";
      presence: "stored-override" | "authored-default" | "derived";
      intrinsic: MechanicValue;
      effective: MechanicValue;
      modifiers: AppliedModifier[];
    }
  >;
  active_status_instances: Array<{
    id: string;
    name: string;
    description?: string;
    source_interaction_id: string;
    source_resolution_id?: string;
    source_effect_id: string;
  }>;
  authored_default_input_mechanic_ids: string[];
}

interface EntityResponse extends IdentifiedResource {
  sheet: EntitySheetResponse;
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
}

interface EffectApplication {
  type: "set" | "adjust-number" | "apply-status" | "remove-status";
  effect_id: string;
  entity_id: string;
  mechanic_id?: string;
  status_instance_id?: string;
  status_name?: string;
  active_before?: boolean;
  active_after?: boolean;
  before?: MechanicValue;
  after?: MechanicValue;
  changed: boolean;
}

interface EffectiveChange {
  entity_id: string;
  mechanic_id: string;
  before: MechanicValue;
  after: MechanicValue;
}

interface ConsequenceApplicationResult {
  interaction_id: string;
  interaction_revision: number;
  rules_revision: number;
  applications: EffectApplication[];
  effective_changes: EffectiveChange[];
  entity_sheets: Record<string, EntitySheetResponse>;
}

interface ConsequencePreviewResult extends ConsequenceApplicationResult {
  preview?: boolean;
}

interface InteractionResolutionResult extends ConsequenceApplicationResult {
  replayed?: boolean;
}

test("world mechanic graph publishes atomically and Status instances change effective values with Resolution receipts", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await signupActor(baseURL, `Graph Author ${unique}`);
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Derived Coast ${unique}` },
    owner.id,
  );
  expect(world.rules_revision).toBe(0);

  const exactMaximum = "9007199254740993";

  const inputMutation = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    {
      kind: "capacity",
      mode: "score",
      source_kind: "input",
      name: "Vigor",
      minimum: "0",
      maximum: exactMaximum,
      step: "1",
      default_number: "10",
      mutable_during_play: true,
      archived: false,
      expected_rules_revision: world.rules_revision,
    },
    owner.id,
  );
  expect(inputMutation).toMatchObject({
    revision: 1,
    mechanic: {
      name: "Vigor",
      source_kind: "input",
      minimum: "0",
      maximum: exactMaximum,
      step: "1",
      default_number: "10",
    },
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
        { operation: "literal", value: numberValue("2") },
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

  const cyclePublication = await actorRequest(owner.id).put(
    `${baseURL}/api/worlds/${world.id}/mechanics/${impact.id}`,
    {
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
  await expectPublishedMechanicGraph(
    request,
    baseURL,
    world.id,
    owner.id,
    derivedMutation.revision,
    impact.id,
    "multiply-number",
  );

  const invalidTypePublication = await actorRequest(owner.id).put(
    `${baseURL}/api/worlds/${world.id}/mechanics/${impact.id}`,
    {
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
  await expectPublishedMechanicGraph(
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
  expect(entity.sheet.logical_input_values).toEqual({
    [vigor.id]: numberValue("10"),
  });
  expect(entity.sheet.effective_values).toMatchObject({
    [vigor.id]: numberValue("10"),
    [impact.id]: numberValue("20"),
  });
  expect(entity.sheet.evaluations[vigor.id]).toMatchObject({
    presence: "authored-default",
  });
  expect(entity.sheet.authored_default_input_mechanic_ids).toEqual([vigor.id]);

  const authoredSheet =
    await test.step("CCY-V03 rejects a stale logical-state/rules save and accepts the authoritative retry", async () => {
      const staleLogicalStateWrite = await actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/logical-state`,
        {
          data: {
            expected_logical_state_revision:
              entity.sheet.logical_state_revision,
            expected_rules_revision: rulesRevision - 1,
            logical_input_values: { [vigor.id]: numberValue("6") },
          },
        },
      );
      await expectAPIError(staleLogicalStateWrite, 409, "revision_conflict");

      const result = await putJSON<EntitySheetResponse>(
        request,
        `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/logical-state`,
        {
          expected_logical_state_revision: entity.sheet.logical_state_revision,
          expected_rules_revision: rulesRevision,
          logical_input_values: { [vigor.id]: numberValue("6") },
        },
        owner.id,
      );
      expect(result).toMatchObject({
        logical_state_revision: 1,
        status_set_revision: 0,
        rules_revision: rulesRevision,
        logical_input_values: { [vigor.id]: numberValue("6") },
        effective_values: {
          [vigor.id]: numberValue("6"),
          [impact.id]: numberValue("12"),
        },
        evaluations: {
          [vigor.id]: {
            source_kind: "input",
            presence: "stored-override",
            intrinsic: numberValue("6"),
            effective: numberValue("6"),
            modifiers: [],
          },
          [impact.id]: {
            source_kind: "derived",
            presence: "derived",
            intrinsic: numberValue("12"),
            effective: numberValue("12"),
            modifiers: [],
          },
        },
        authored_default_input_mechanic_ids: [],
      });
      expect(Object.keys(result.logical_input_values)).toEqual([vigor.id]);
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
              value: numberValue("-2"),
              priority: 10,
            },
          ],
        },
      },
    ],
  };

  const stalePreview = await actorRequest(owner.id).post(
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/preview`,
    {
      data: { ...applyPayload, expected_rules_revision: rulesRevision - 1 },
    },
  );
  await expectAPIError(stalePreview, 409, "revision_conflict");

  const applyPreview = await postJSON<ConsequencePreviewResult>(
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
    applications: [
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
  expect(applyPreview.applications[0]?.status_instance_id).toBeTruthy();
  expect(applyPreview.effective_changes).toEqual(
    expect.arrayContaining([
      effectiveChange(entity.id, vigor.id, "6", "4"),
      effectiveChange(entity.id, impact.id, "12", "8"),
    ]),
  );
  expect(
    applyPreview.entity_sheets[entity.id]?.active_status_instances,
  ).toMatchObject([
    {
      name: "Weakened",
      description: "Vigor is reduced while this consequence remains active.",
      source_interaction_id: applyInteraction.id,
      source_effect_id: applyEffectID,
    },
  ]);

  const sheetAfterPreview = await getJSON<EntitySheetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/sheet`,
    owner.id,
  );
  expect(sheetAfterPreview).toMatchObject({
    logical_state_revision: authoredSheet.logical_state_revision,
    status_set_revision: 0,
    active_status_instances: [],
  });

  const applyIdempotencyKey = randomUUID();
  const applyResult = await postJSON<InteractionResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
    { ...applyPayload, idempotency_key: applyIdempotencyKey },
    owner.id,
  );
  expect(applyResult).toMatchObject({
    interaction_id: applyInteraction.id,
    interaction_revision: applyInteraction.revision + 1,
    rules_revision: rulesRevision,
    applications: [
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
      effectiveChange(entity.id, vigor.id, "6", "4"),
      effectiveChange(entity.id, impact.id, "12", "8"),
    ]),
  );

  const replayedApply = await postJSON<InteractionResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
    { ...applyPayload, idempotency_key: applyIdempotencyKey },
    owner.id,
  );
  expect(replayedApply).toMatchObject({
    replayed: true,
    interaction_id: applyResult.interaction_id,
    interaction_revision: applyResult.interaction_revision,
    applications: applyResult.applications,
  });
  await expectAPIError(
    await actorRequest(owner.id).post(
      `${baseURL}/api/worlds/${world.id}/interactions/${applyInteraction.id}/resolve`,
      {
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

  const weakenedSheet = await getJSON<EntitySheetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/sheet`,
    owner.id,
  );
  expect(weakenedSheet).toMatchObject({
    logical_state_revision: authoredSheet.logical_state_revision,
    status_set_revision: 1,
    rules_revision: rulesRevision,
    logical_input_values: { [vigor.id]: numberValue("6") },
    effective_values: {
      [vigor.id]: numberValue("4"),
      [impact.id]: numberValue("8"),
    },
    active_status_instances: [
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
        presence: "stored-override",
        intrinsic: numberValue("6"),
        effective: numberValue("4"),
        modifiers: [
          {
            status_name: "Weakened",
            operation: "add-number",
            operand: numberValue("-2"),
            before: numberValue("6"),
            after: numberValue("4"),
          },
        ],
      },
      [impact.id]: {
        source_kind: "derived",
        presence: "derived",
        intrinsic: numberValue("8"),
        effective: numberValue("8"),
        modifiers: [],
      },
    },
  });

  const weakenedInstance = weakenedSheet.active_status_instances[0];
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
  const removePreview = await postJSON<ConsequencePreviewResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${removeInteraction.id}/preview`,
    removePayload,
    owner.id,
  );
  expect(removePreview.applications).toMatchObject([
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
      effectiveChange(entity.id, vigor.id, "4", "6"),
      effectiveChange(entity.id, impact.id, "8", "12"),
    ]),
  );

  const removeResult = await postJSON<InteractionResolutionResult>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${removeInteraction.id}/resolve`,
    { ...removePayload, idempotency_key: randomUUID() },
    owner.id,
  );
  expect(removeResult).toMatchObject({
    interaction_id: removeInteraction.id,
    interaction_revision: removeInteraction.revision + 1,
    rules_revision: rulesRevision,
    applications: [
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
      effectiveChange(entity.id, vigor.id, "4", "6"),
      effectiveChange(entity.id, impact.id, "8", "12"),
    ]),
  );

  const restoredSheet = await getJSON<EntitySheetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${entity.id}/sheet`,
    owner.id,
  );
  expect(restoredSheet).toMatchObject({
    logical_state_revision: authoredSheet.logical_state_revision,
    status_set_revision: 2,
    rules_revision: rulesRevision,
    logical_input_values: { [vigor.id]: numberValue("6") },
    effective_values: {
      [vigor.id]: numberValue("6"),
      [impact.id]: numberValue("12"),
    },
    active_status_instances: [],
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
    narrative: `Only one consequence wins ${unique}`,
    effects: [],
  };
  const competingResponses = await Promise.all([
    actorRequest(owner.id).post(
      `${baseURL}/api/worlds/${world.id}/interactions/${competingInteraction.id}/resolve`,
      {
        data: { ...competingPayload, idempotency_key: randomUUID() },
      },
    ),
    actorRequest(owner.id).post(
      `${baseURL}/api/worlds/${world.id}/interactions/${competingInteraction.id}/resolve`,
      {
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

async function expectPublishedMechanicGraph(
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
  contextEntityID: string,
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
      context_entity_ids: [contextEntityID],
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

function numberValue(value: DecimalText): MechanicValue {
  return { kind: "number", value };
}

function booleanValue(value: boolean): MechanicValue {
  return { kind: "boolean", value };
}

function effectiveChange(
  entityID: string,
  mechanicID: string,
  before: DecimalText,
  after: DecimalText,
): EffectiveChange {
  return {
    entity_id: entityID,
    mechanic_id: mechanicID,
    before: numberValue(before),
    after: numberValue(after),
  };
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  userID?: string,
): Promise<T> {
  const response = await getAs(request, url, userID);
  return expectJSON<T>(response, url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await postAs(request, url, data, userID);
  return expectJSON<T>(response, url);
}

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  userID?: string,
): Promise<T> {
  const response = await putAs(request, url, data, userID);
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
