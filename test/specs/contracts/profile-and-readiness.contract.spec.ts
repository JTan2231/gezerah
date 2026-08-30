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

interface IdentifiedResource {
  id: string;
}

test.afterEach(async () => disposeAuthenticatedActors());

interface WorldResponse extends IdentifiedResource {
  membership_id: string;
  rules_revision: number;
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface InviteResponse extends IdentifiedResource {
  join_path?: string;
}

interface CharacterFieldSetResponse {
  revision: number;
  fields: Array<{
    id: string;
    label: string;
    help_text?: string;
    visibility: "world" | "restricted";
  }>;
}

interface MechanicMutationResponse {
  revision: number;
  mechanic: IdentifiedResource;
}

interface EntityResponse extends IdentifiedResource {
  sheet: {
    entity_id: string;
    logical_state_revision: number;
    status_set_revision: number;
    rules_revision: number;
    logical_input_values: Record<string, unknown>;
    effective_values: Record<string, unknown>;
    evaluations: Record<string, unknown>;
    active_status_instances: unknown[];
    authored_default_input_mechanic_ids: string[];
  };
}

interface EntityProfileResponse {
  entity_id: string;
  revision: number;
  character_field_set_revision: number;
  character_status: "not-controlled" | "setup-required" | "ready";
  required_field_count: number;
  completed_field_count: number;
  can_edit: boolean;
  fields: Array<{
    id: string;
    label: string;
    value?: string;
    visibility: "world" | "restricted";
  }>;
}

interface InteractionResponse extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
}

test("contract: readiness and profile projections preserve authority and privacy", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await createActor(request, baseURL, `Profile Owner ${unique}`);
  const player = await createActor(
    request,
    baseURL,
    `Profile Player ${unique}`,
  );
  const spectator = await createActor(
    request,
    baseURL,
    `Profile Spectator ${unique}`,
  );
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/api/worlds`,
    { name: `Profile World ${unique}` },
    owner.id,
  );

  const emptyFields = await getJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    owner.id,
  );
  const fields = await putJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    {
      expected_revision: emptyFields.revision,
      fields: [
        {
          label: `World-visible story ${unique}`,
          help_text: "What may the whole World know?",
          visibility: "world",
        },
        {
          label: `Restricted oath ${unique}`,
          help_text: "What is reserved for Controllers and the facilitator?",
          visibility: "restricted",
        },
      ],
    },
    owner.id,
  );
  const worldVisibleField = required(fields.fields[0], "world-visible field");
  const restrictedField = required(fields.fields[1], "restricted field");

  const mechanic = await postJSON<MechanicMutationResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/mechanics`,
    {
      kind: "capacity",
      mode: "score",
      source_kind: "input",
      name: `Bearing ${unique}`,
      minimum: "0",
      maximum: "10",
      step: "1",
      default_number: "8",
      mutable_during_play: true,
      archived: false,
      expected_rules_revision: world.rules_revision,
    },
    owner.id,
  );
  expect(mechanic.revision).toBe(world.rules_revision + 1);

  const joinedPlayer = await redeemInvite(
    request,
    baseURL,
    world.id,
    owner.id,
    player.id,
    "player",
  );
  await redeemInvite(
    request,
    baseURL,
    world.id,
    owner.id,
    spectator.id,
    "spectator",
  );
  expect(joinedPlayer.play_status).toBe("waiting-for-character");

  const controlled = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    {
      display_name: `Controlled Courier ${unique}`,
      controller_world_membership_ids: [joinedPlayer.membership_id],
    },
    owner.id,
  );
  const uncontrolled = await postJSON<EntityResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities`,
    { display_name: `Uncontrolled Sentinel ${unique}` },
    owner.id,
  );

  const beforeProfile = await getJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
    player.id,
  );
  expect(beforeProfile).toMatchObject({
    revision: 0,
    character_status: "setup-required",
    required_field_count: 2,
    completed_field_count: 0,
    can_edit: true,
  });
  await expectAPIError(
    await actorRequest(player.id).get(
      `${baseURL}/api/worlds/${world.id}/interactions`,
      {},
    ),
    403,
    "character_setup_required",
  );

  const worldVisibleStory = `Raised beside the salt lamps ${unique}.`;
  const restrictedStory = `Carries the unbroken seal ${unique}.`;
  const partial = await putJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
    {
      expected_revision: beforeProfile.revision,
      expected_character_field_set_revision: fields.revision,
      values: [{ field_id: worldVisibleField.id, value: worldVisibleStory }],
    },
    player.id,
  );
  expect(partial).toMatchObject({
    revision: 1,
    character_status: "setup-required",
    completed_field_count: 1,
  });
  expect(
    (
      await getJSON<WorldResponse>(
        request,
        `${baseURL}/api/worlds/${world.id}`,
        player.id,
      )
    ).play_status,
  ).toBe("setup-required");
  expect(
    (
      await actorRequest(player.id).get(
        `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/sheet`,
        {},
      )
    ).status(),
  ).toBe(200);
  expect(
    (
      await actorRequest(player.id).get(
        `${baseURL}/api/worlds/${world.id}/entities/${uncontrolled.id}/sheet`,
        {},
      )
    ).status(),
  ).toBe(403);

  const complete = await putJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
    {
      expected_revision: partial.revision,
      expected_character_field_set_revision: fields.revision,
      values: [
        { field_id: worldVisibleField.id, value: worldVisibleStory },
        { field_id: restrictedField.id, value: restrictedStory },
      ],
    },
    player.id,
  );
  expect(complete).toMatchObject({
    revision: 2,
    character_status: "ready",
    completed_field_count: 2,
  });
  expect(
    (
      await getJSON<WorldResponse>(
        request,
        `${baseURL}/api/worlds/${world.id}`,
        player.id,
      )
    ).play_status,
  ).toBe("ready");

  await test.step("AUT-V03 omits restricted Character-field definitions and Entity-profile values", async () => {
    const spectatorProjection = await getJSON<EntityProfileResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
      spectator.id,
    );
    expect(spectatorProjection).toMatchObject({
      entity_id: controlled.id,
      revision: 2,
      character_status: "ready",
      required_field_count: 2,
      completed_field_count: 2,
      can_edit: false,
    });
    expect(spectatorProjection.fields).toEqual([
      expect.objectContaining({
        id: worldVisibleField.id,
        value: worldVisibleStory,
        visibility: "world",
      }),
    ]);
    expect(JSON.stringify(spectatorProjection)).not.toContain(restrictedStory);
    expect(JSON.stringify(spectatorProjection)).not.toContain(
      restrictedField.id,
    );
  });

  expect(
    (
      await actorRequest(spectator.id).put(
        `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
        {
          data: {
            expected_revision: complete.revision,
            expected_character_field_set_revision: fields.revision,
            values: [],
          },
        },
      )
    ).status(),
  ).toBe(403);
  await expectAPIError(
    await actorRequest(player.id).put(
      `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
      {
        data: {
          expected_revision: 0,
          expected_character_field_set_revision: fields.revision,
          values: [
            { field_id: worldVisibleField.id, value: worldVisibleStory },
            { field_id: restrictedField.id, value: restrictedStory },
          ],
        },
      },
    ),
    409,
    "revision_conflict",
  );
  const unchangedProfile = await getJSON<EntityProfileResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/entities/${controlled.id}/profile`,
    player.id,
  );
  expect(unchangedProfile).toMatchObject({
    revision: complete.revision,
    character_field_set_revision: fields.revision,
    character_status: "ready",
    completed_field_count: 2,
  });
  expect(unchangedProfile.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: worldVisibleField.id,
        value: worldVisibleStory,
      }),
      expect.objectContaining({
        id: restrictedField.id,
        value: restrictedStory,
      }),
    ]),
  );
  expect(
    (
      await getJSON<EntityResponse[]>(
        request,
        `${baseURL}/api/worlds/${world.id}/entities`,
        player.id,
      )
    ).find((entity) => entity.id === controlled.id)?.sheet
      .logical_state_revision,
  ).toBe(0);

  const openInteraction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions`,
    {
      present: true,
      prompt: `The profile contract remains in use ${unique}.`,
      eligible_responder_membership_ids: [joinedPlayer.membership_id],
      context_entity_ids: [controlled.id],
    },
    owner.id,
  );
  expect(openInteraction).toMatchObject({ status: "open", revision: 1 });

  const expandedFieldRequest = {
    expected_revision: fields.revision,
    fields: [
      ...fields.fields.map((field) => ({
        id: field.id,
        label: field.label,
        help_text: field.help_text,
        visibility: field.visibility,
      })),
      {
        label: `New bond ${unique}`,
        help_text: "What now binds this Character to the World?",
        visibility: "world" as const,
      },
    ],
  };
  await test.step("CHF-V01 blocks character-field-set changes during unfinished play", async () => {
    await expectAPIError(
      await actorRequest(owner.id).put(
        `${baseURL}/api/worlds/${world.id}/character-fields`,
        {
          data: expandedFieldRequest,
        },
      ),
      409,
      "character_fields_in_use",
    );
    const fieldsAfterDenial = await getJSON<CharacterFieldSetResponse>(
      request,
      `${baseURL}/api/worlds/${world.id}/character-fields`,
      owner.id,
    );
    expect(fieldsAfterDenial).toEqual(fields);
  });
  await postJSON<InteractionResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/interactions/${openInteraction.id}/cancel`,
    { expected_revision: openInteraction.revision },
    owner.id,
  );

  const expandedFields = await putJSON<CharacterFieldSetResponse>(
    request,
    `${baseURL}/api/worlds/${world.id}/character-fields`,
    expandedFieldRequest,
    owner.id,
  );
  expect(expandedFields.revision).toBe(fields.revision + 1);
  expect(
    (
      await getJSON<WorldResponse>(
        request,
        `${baseURL}/api/worlds/${world.id}`,
        player.id,
      )
    ).play_status,
  ).toBe("setup-required");
  await expectAPIError(
    await actorRequest(player.id).get(
      `${baseURL}/api/worlds/${world.id}/interactions`,
      {},
    ),
    403,
    "character_setup_required",
  );
});

async function createActor(
  _request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<IdentifiedResource> {
  return signupActor(baseURL, displayName);
}

async function redeemInvite(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  userID: string,
  role: "player" | "spectator",
): Promise<WorldResponse> {
  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role, expires_in_days: 7 },
    ownerID,
  );
  const token = required(invite.join_path?.split("/").at(-1), `${role} token`);
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    userID,
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
  status: number,
  code: string,
): Promise<void> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as { error?: { code?: string } };
  expect(decoded.error?.code).toBe(code);
}

function required<T>(value: T | undefined, label: string): T {
  expect(value, `${label} is present`).toBeDefined();
  return value as T;
}
