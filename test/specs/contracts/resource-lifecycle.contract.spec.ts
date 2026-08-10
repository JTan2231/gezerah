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

const CASE_MANIFEST = {
  "MEC-V03": ["unknown", "cross-world", "archived"],
  "RST-V03": [
    "incomplete-context",
    "archived-context",
    "incomplete-attribution",
    "archived-attribution",
    "incomplete-effect-target",
    "archived-effect-target",
  ],
  "LFC-V04": [
    "world-mutation",
    "entity-mutation",
    "mechanic-mutation",
    "archived-new-reference",
  ],
} as const;

test.afterEach(async () => disposeAuthenticatedActors());

type ScenarioID = keyof typeof CASE_MANIFEST;
type CaseKey = (typeof CASE_MANIFEST)[ScenarioID][number];

interface IdentifiedResource {
  id: string;
}

interface WorldResponse extends IdentifiedResource {
  name: string;
  status: "active" | "archived";
  revision: number;
  rules_revision: number;
  membership_id: string;
}

interface InviteResponse extends IdentifiedResource {
  join_path?: string;
}

interface MechanicResponse extends IdentifiedResource {
  name: string;
  archived: boolean;
}

interface MechanicMutationResponse {
  revision: number;
  mechanic: MechanicResponse;
}

interface MechanicCollectionResponse {
  revision: number;
  mechanics: MechanicResponse[];
}

interface CharacterFieldSetResponse {
  revision: number;
  fields: Array<{ id: string; label: string }>;
}

interface StateResponse {
  revision: number;
  status_revision: number;
  rules_revision: number;
  values: Record<string, unknown>;
  active_statuses: Array<unknown>;
}

interface EntityResponse extends IdentifiedResource {
  display_name: string;
  archived: boolean;
  character_status: "not-controlled" | "setup-required" | "ready";
  state: StateResponse;
}

interface EntityProfileResponse {
  entity_id: string;
  revision: number;
  character_fields_revision: number;
  character_status: "not-controlled" | "setup-required" | "ready";
  fields: Array<{ id: string; value?: string }>;
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  entity_ids: string[];
  actions: Array<unknown>;
  resolution?: unknown;
}

interface APIErrorBody {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
  };
}

interface APIErrorContract {
  status: number;
  code: string;
  message: string;
  fields?: Record<string, string>;
}

interface DerivedReferenceCase {
  key: (typeof CASE_MANIFEST)["MEC-V03"][number];
  referencedMechanicID: string;
  referencedSecret?: string;
  expectedMessage: string;
}

test("contract: scenario matrices reject invalid and archived resource use atomically", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const observedCases = new Set<string>();
  const runCase = async (
    scenarioID: ScenarioID,
    caseKey: CaseKey,
    body: () => Promise<void>,
  ): Promise<void> => {
    observedCases.add(`${scenarioID}/${caseKey}`);
    await test.step(`${scenarioID} [${caseKey}]`, body);
  };

  const owner = await createActor(
    request,
    baseURL,
    `Lifecycle Author ${unique}`,
  );
  const mainWorld = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Copper Meridian ${unique}` },
    owner.id,
  );
  const foreignWorld = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Foreign Observatory ${unique}` },
    owner.id,
  );

  const activeMechanicRequest = inputMechanicRequest(
    `Signal Reserve ${unique}`,
    mainWorld.rules_revision,
  );
  const activeMechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
    activeMechanicRequest,
    owner.id,
  );
  const archivedMechanicRequest = inputMechanicRequest(
    `Retired Bearing ${unique}`,
    activeMechanic.revision,
  );
  const createdArchivedMechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
    archivedMechanicRequest,
    owner.id,
  );
  const archivedMechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/mechanics/${createdArchivedMechanic.mechanic.id}/archive`,
    { expected_rules_revision: createdArchivedMechanic.revision },
    owner.id,
  );
  expect(archivedMechanic.mechanic.archived).toBe(true);

  const foreignMechanicName = `Foreign Frequency ${unique}`;
  const foreignMechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${foreignWorld.id}/mechanics`,
    inputMechanicRequest(foreignMechanicName, foreignWorld.rules_revision),
    owner.id,
  );

  const mechanicReferenceCases: readonly DerivedReferenceCase[] = [
    {
      key: "unknown",
      referencedMechanicID: randomUUID(),
      expectedMessage: "referenced mechanic does not exist",
    },
    {
      key: "cross-world",
      referencedMechanicID: foreignMechanic.mechanic.id,
      referencedSecret: foreignMechanicName,
      expectedMessage: "referenced mechanic does not exist",
    },
    {
      key: "archived",
      referencedMechanicID: archivedMechanic.mechanic.id,
      expectedMessage:
        "active derived mechanics cannot reference archived mechanics",
    },
  ];

  for (const matrixCase of mechanicReferenceCases) {
    await runCase("MEC-V03", matrixCase.key, async () => {
      const before = await getJSON<MechanicCollectionResponse>(
        request,
        `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
        owner.id,
      );
      const candidateID = randomUUID();
      const response = await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
        {
          data: derivedMechanicRequest(
            candidateID,
            `Rejected ${matrixCase.key} graph ${unique}`,
            matrixCase.referencedMechanicID,
            before.revision,
          ),
        },
      );
      const body = await expectAPIError(
        response,
        {
          status: 422,
          code: "validation_failed",
          message: "world rules are invalid",
          fields: {
            [`mechanics[${candidateID}].expression.mechanic_id`]:
              matrixCase.expectedMessage,
          },
        },
        true,
      );
      if (matrixCase.key === "cross-world") {
        expect
          .soft(JSON.stringify(body))
          .not.toContain(matrixCase.referencedMechanicID);
        expect
          .soft(JSON.stringify(body))
          .not.toContain(matrixCase.referencedSecret);
      }
      expect
        .soft(
          await getJSON<MechanicCollectionResponse>(
            request,
            `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
            owner.id,
          ),
        )
        .toEqual(before);
    });
  }

  const initialFields = await getJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/character-fields`,
    owner.id,
  );
  const characterFields = await putJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/character-fields`,
    {
      expected_revision: initialFields.revision,
      fields: [
        {
          label: `Table identity ${unique}`,
          visibility: "table",
        },
      ],
    },
    owner.id,
  );
  const requiredField = required(characterFields.fields[0], "character field");

  const readyPlayer = await createActor(
    request,
    baseURL,
    `Ready Player ${unique}`,
  );
  const incompletePlayer = await createActor(
    request,
    baseURL,
    `Setup Player ${unique}`,
  );
  const readyMembership = await joinWorldAsPlayer(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    readyPlayer.id,
  );
  const incompleteMembership = await joinWorldAsPlayer(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    incompletePlayer.id,
  );

  const readyEntity = await createEntity(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    `Glasswing Courier ${unique}`,
    readyMembership.membership_id,
  );
  await completeProfile(
    request,
    baseURL,
    mainWorld.id,
    readyEntity.id,
    owner.id,
    characterFields.revision,
    requiredField.id,
    `Known at the copper table ${unique}`,
  );

  const incompleteEntity = await createEntity(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    `Unfinished Envoy ${unique}`,
    incompleteMembership.membership_id,
  );
  expect(incompleteEntity.character_status).toBe("setup-required");

  const archivedEntity = await createEntity(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    `Retired Pathfinder ${unique}`,
    readyMembership.membership_id,
  );
  await test.step("LFC-003 archives an entity into read-only history", async () => {
    const result = await postJSON<EntityResponse>(
      request,
      `${baseURL}/api/worlds/${mainWorld.id}/entities/${archivedEntity.id}/archive`,
      undefined,
      owner.id,
    );
    expect(result.archived).toBe(true);
  });

  const contextCases = [
    {
      key: "incomplete-context",
      entityID: incompleteEntity.id,
      fieldMessage: "controlled character setup must be complete",
    },
    {
      key: "archived-context",
      entityID: archivedEntity.id,
      fieldMessage: "archived entity cannot be added to a new interaction",
    },
  ] as const;
  let interactionsSnapshot = await getJSON<InteractionResponse[]>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/interactions`,
    owner.id,
  );
  for (const matrixCase of contextCases) {
    await runCase("RST-V03", matrixCase.key, async () => {
      const response = await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${mainWorld.id}/interactions`,
        {
          data: {
            id: randomUUID(),
            prompt: `Rejected ${matrixCase.key} selection ${unique}`,
            entity_ids: [matrixCase.entityID],
            eligible_responder_membership_ids: [],
          },
        },
      );
      await expectAPIError(
        response,
        {
          status: 422,
          code: "validation_failed",
          message: "interaction is invalid",
          fields: { "entity_ids[0]": matrixCase.fieldMessage },
        },
        true,
      );
      expect
        .soft(
          await getJSON<InteractionResponse[]>(
            request,
            `${baseURL}/api/worlds/${mainWorld.id}/interactions`,
            owner.id,
          ),
        )
        .toEqual(interactionsSnapshot);
    });
  }

  const openInteraction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/interactions`,
    {
      present: true,
      prompt: `The lamps gutter above the crossing ${unique}.`,
      eligible_responder_membership_ids: [readyMembership.membership_id],
      entity_ids: [readyEntity.id],
    },
    owner.id,
  );
  expect(openInteraction).toMatchObject({ status: "open", revision: 1 });

  const attributionIncompleteEntity = await createEntity(
    request,
    baseURL,
    mainWorld.id,
    owner.id,
    `Half-written Navigator ${unique}`,
    readyMembership.membership_id,
  );
  let interactionSnapshot = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}`,
    owner.id,
  );
  await runCase("RST-V03", "incomplete-attribution", async () => {
    await expectAPIError(
      await actorRequest(readyPlayer.id).post(
        `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}/actions`,
        {
          data: {
            expected_revision: interactionSnapshot.revision,
            acting_entity_id: attributionIncompleteEntity.id,
            text: `The unfinished navigator reaches for the line ${unique}.`,
          },
        },
      ),
      {
        status: 403,
        code: "character_setup_required",
        message: "complete a controlled character before entering live play",
        fields: { play_status: "setup-required" },
      },
      true,
    );
    expect
      .soft(
        await getJSON<InteractionResponse>(
          request,
          `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}`,
          owner.id,
        ),
      )
      .toEqual(interactionSnapshot);
  });

  await completeProfile(
    request,
    baseURL,
    mainWorld.id,
    attributionIncompleteEntity.id,
    owner.id,
    characterFields.revision,
    requiredField.id,
    `Chart completed beside the crossing ${unique}`,
  );

  await runCase("RST-V03", "archived-attribution", async () => {
    await expectAPIError(
      await actorRequest(readyPlayer.id).post(
        `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}/actions`,
        {
          data: {
            expected_revision: interactionSnapshot.revision,
            acting_entity_id: archivedEntity.id,
            text: `A retired pathfinder cannot claim the crossing ${unique}.`,
          },
        },
      ),
      {
        status: 409,
        code: "entity_archived",
        message: "archived entities cannot act in a new interaction",
      },
      true,
    );
    expect
      .soft(
        await getJSON<InteractionResponse>(
          request,
          `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}`,
          owner.id,
        ),
      )
      .toEqual(interactionSnapshot);
  });

  const adjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}/adjudicate`,
    { expected_revision: interactionSnapshot.revision },
    owner.id,
  );
  expect(adjudicating).toMatchObject({ status: "adjudicating", revision: 2 });
  interactionSnapshot = adjudicating;

  const effectTargetCases = [
    {
      key: "incomplete-effect-target",
      entityID: incompleteEntity.id,
      fieldMessage: "controlled character setup must be complete",
    },
    {
      key: "archived-effect-target",
      entityID: archivedEntity.id,
      fieldMessage: "archived entities cannot be changed",
    },
  ] as const;
  for (const matrixCase of effectTargetCases) {
    await runCase("RST-V03", matrixCase.key, async () => {
      const beforeInteraction = await getJSON<InteractionResponse>(
        request,
        `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}`,
        owner.id,
      );
      const beforeState = await getJSON<StateResponse>(
        request,
        `${baseURL}/api/worlds/${mainWorld.id}/entities/${matrixCase.entityID}/state`,
        owner.id,
      );
      await expectAPIError(
        await actorRequest(owner.id).post(
          `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}/preview`,
          {
            data: {
              expected_revision: beforeInteraction.revision,
              expected_rules_revision: archivedMechanic.revision,
              narrative: `Rejected ${matrixCase.key} consequence ${unique}.`,
              effects: [
                {
                  id: randomUUID(),
                  type: "apply-status",
                  targets: [{ entity_id: matrixCase.entityID }],
                  status: {
                    name: `Invalid target ${unique}`,
                    modifiers: [],
                  },
                },
              ],
            },
          },
        ),
        {
          status: 422,
          code: "transition_failed",
          message: `invalid transition: effects[0].entity_ids[0]: ${matrixCase.fieldMessage}`,
          fields: { "effects[0].entity_ids[0]": matrixCase.fieldMessage },
        },
        true,
      );
      expect
        .soft(
          await getJSON<InteractionResponse>(
            request,
            `${baseURL}/api/worlds/${mainWorld.id}/interactions/${openInteraction.id}`,
            owner.id,
          ),
        )
        .toEqual(beforeInteraction);
      expect
        .soft(
          await getJSON<StateResponse>(
            request,
            `${baseURL}/api/worlds/${mainWorld.id}/entities/${matrixCase.entityID}/state`,
            owner.id,
          ),
        )
        .toEqual(beforeState);
    });
  }

  await runCase("LFC-V04", "archived-new-reference", async () => {
    const before = await getJSON<MechanicCollectionResponse>(
      request,
      `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
      owner.id,
    );
    const candidateID = randomUUID();
    await expectAPIError(
      await actorRequest(owner.id).post(
        `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
        {
          data: derivedMechanicRequest(
            candidateID,
            `Archived dependency attempt ${unique}`,
            archivedMechanic.mechanic.id,
            before.revision,
          ),
        },
      ),
      {
        status: 422,
        code: "validation_failed",
        message: "world rules are invalid",
        fields: {
          [`mechanics[${candidateID}].expression.mechanic_id`]:
            "active derived mechanics cannot reference archived mechanics",
        },
      },
      true,
    );
    expect
      .soft(
        await getJSON<MechanicCollectionResponse>(
          request,
          `${baseURL}/api/worlds/${mainWorld.id}/mechanics`,
          owner.id,
        ),
      )
      .toEqual(before);
  });

  await runCase("LFC-V04", "entity-mutation", async () => {
    const before = await getJSON<EntityResponse>(
      request,
      `${baseURL}/api/worlds/${mainWorld.id}/entities/${archivedEntity.id}`,
      owner.id,
    );
    await expectAPIError(
      await actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${mainWorld.id}/entities/${archivedEntity.id}`,
        {
          data: {
            display_name: `Mutated retired pathfinder ${unique}`,
            archived: true,
          },
        },
      ),
      {
        status: 409,
        code: "entity_archived",
        message: "archived entities cannot be changed",
      },
      true,
    );
    expect
      .soft(
        await getJSON<EntityResponse>(
          request,
          `${baseURL}/api/worlds/${mainWorld.id}/entities/${archivedEntity.id}`,
          owner.id,
        ),
      )
      .toEqual(before);
  });

  await runCase("LFC-V04", "mechanic-mutation", async () => {
    const before = await getJSON<MechanicMutationResponse>(
      request,
      `${baseURL}/api/worlds/${mainWorld.id}/mechanics/${archivedMechanic.mechanic.id}`,
      owner.id,
    );
    await expectAPIError(
      await actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${mainWorld.id}/mechanics/${archivedMechanic.mechanic.id}`,
        {
          data: {
            ...archivedMechanicRequest,
            name: `Mutated retired bearing ${unique}`,
            archived: true,
            expected_rules_revision: before.revision,
          },
        },
      ),
      {
        status: 409,
        code: "mechanic_archived",
        message: "archived mechanics cannot be changed",
      },
      true,
    );
    expect
      .soft(
        await getJSON<MechanicMutationResponse>(
          request,
          `${baseURL}/api/worlds/${mainWorld.id}/mechanics/${archivedMechanic.mechanic.id}`,
          owner.id,
        ),
      )
      .toEqual(before);
  });

  await runCase("LFC-V04", "world-mutation", async () => {
    const world = await postJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds`,
      { name: `Finished Archive ${unique}` },
      owner.id,
    );
    const archived = await postJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/archive`,
      { expected_revision: world.revision },
      owner.id,
    );
    expect(archived.status).toBe("archived");
    const before = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}`,
      owner.id,
    );
    await expectAPIError(
      await actorRequest(owner.id).patch(`${baseURL}/api/worlds/${world.id}`, {
        data: {
          name: `Mutated archive ${unique}`,
          expected_revision: before.revision,
        },
      }),
      {
        status: 409,
        code: "world_archived",
        message: "archived worlds cannot be changed",
      },
      true,
    );
    expect
      .soft(
        await getJSON<WorldResponse>(
          request,
          `${baseURL}/api/worlds/${world.id}`,
          owner.id,
        ),
      )
      .toEqual(before);
  });

  const expectedCases = Object.entries(CASE_MANIFEST)
    .flatMap(([scenarioID, caseKeys]) =>
      caseKeys.map((caseKey) => `${scenarioID}/${caseKey}`),
    )
    .sort();
  expect([...observedCases].sort()).toEqual(expectedCases);
});

function inputMechanicRequest(name: string, expectedRulesRevision: number) {
  return {
    kind: "capacity",
    mode: "score",
    source_kind: "input",
    name,
    minimum: "0",
    maximum: "12",
    step: "1",
    default_number: "6",
    mutable_during_play: true,
    archived: false,
    expected_rules_revision: expectedRulesRevision,
  } as const;
}

function derivedMechanicRequest(
  id: string,
  name: string,
  referencedMechanicID: string,
  expectedRulesRevision: number,
) {
  return {
    id,
    kind: "capacity",
    mode: "score",
    source_kind: "derived",
    name,
    mutable_during_play: false,
    archived: false,
    expected_rules_revision: expectedRulesRevision,
    expression: {
      operation: "mechanic-reference",
      mechanic_id: referencedMechanicID,
    },
  } as const;
}

async function createActor(
  _request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<IdentifiedResource> {
  return signupActor(baseURL, displayName);
}

async function joinWorldAsPlayer(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  playerID: string,
): Promise<WorldResponse> {
  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role: "player", expires_in_days: 7 },
    ownerID,
  );
  const token = required(
    invite.join_path?.split("/").at(-1),
    "player invite token",
  );
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    playerID,
  );
}

async function createEntity(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  displayName: string,
  controllerMembershipID: string,
): Promise<EntityResponse> {
  return postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities`,
    {
      display_name: displayName,
      controller_world_membership_ids: [controllerMembershipID],
    },
    ownerID,
  );
}

async function completeProfile(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  ownerID: string,
  characterFieldsRevision: number,
  fieldID: string,
  value: string,
): Promise<EntityProfileResponse> {
  const before = await getJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    ownerID,
  );
  return putJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    {
      expected_revision: before.revision,
      expected_character_fields_revision: characterFieldsRevision,
      values: [{ field_id: fieldID, value }],
    },
    ownerID,
  );
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
  contract: APIErrorContract,
  soft = false,
): Promise<APIErrorBody> {
  const text = await response.text();
  let body: APIErrorBody = {};
  try {
    body = JSON.parse(text) as APIErrorBody;
  } catch {
    // Assertions below retain only a sanitized body in diagnostics.
  }
  const assertion = soft ? expect.soft : expect;
  const diagnostic = sanitizeDiagnosticBody(text);
  assertion(response.status(), diagnostic).toBe(contract.status);
  if (response.status() !== contract.status) {
    return body;
  }
  assertion(body.error?.code, diagnostic).toBe(contract.code);
  assertion(body.error?.message, diagnostic).toBe(contract.message);
  if (contract.fields !== undefined) {
    assertion(body.error?.fields, diagnostic).toEqual(contract.fields);
  } else {
    assertion(body.error?.fields, diagnostic).toBeUndefined();
  }
  return body;
}

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
