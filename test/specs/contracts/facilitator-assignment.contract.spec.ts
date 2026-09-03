import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { TERRA_MODEL_FAILURE_MARKER } from "../../src/openAIStubServer";
import { readBaseURL } from "../../src/runtime";
import { sanitizeDiagnosticBody, sanitizeURL } from "../../src/scenario";
import {
  disposeAuthenticatedActors,
  getAs,
  postAs,
  putAs,
  signupActor,
} from "../support/auth";

test.afterEach(async () => disposeAuthenticatedActors());

type MembershipRole = "owner" | "editor" | "player" | "spectator";
type CurrentPlayRole = "facilitator" | "player" | "spectator";
type PlayStatus =
  "waiting-for-character" | "setup-required" | "ready" | "unavailable";
type FacilitatorSource = "human" | "terra" | "agent";

interface WorldResponse {
  id: string;
  membership_id: string;
  role: MembershipRole;
  revision: number;
  rules_revision: number;
  facilitator: {
    source: FacilitatorSource;
    membership_id?: string;
    display_name?: string;
  };
  current_play_role: CurrentPlayRole;
  play_status: PlayStatus;
}

interface WorldMemberResponse {
  id: string;
  user_id: string;
  role: MembershipRole;
  current_play_role: CurrentPlayRole;
  play_status: PlayStatus;
  controlled_entity_ids: string[];
}

interface InviteResponse {
  id: string;
  role: Exclude<MembershipRole, "owner">;
  join_path?: string;
}

interface EntityResponse {
  id: string;
  display_name: string;
  character_status: "not-controlled" | "setup-required" | "ready";
}

interface InteractionActionResponse {
  id: string;
  submitted_by_membership_id: string;
  text: string;
  status: "submitted" | "withdrawn" | "selected" | "declined";
  revision: number;
}

interface InteractionResponse {
  id: string;
  prompt: string;
  facilitator_source: FacilitatorSource;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
  revision: number;
  eligible_responder_membership_ids: string[];
  actions: InteractionActionResponse[];
}

test("contract: facilitator assignment changes play authority without rewriting membership roles", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await signupActor(baseURL, `Seat Owner ${unique}`);
  const delegate = await signupActor(baseURL, `Seat Delegate ${unique}`);
  const editor = await signupActor(baseURL, `Seat Editor ${unique}`);

  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds`,
    { name: `Facilitator Contract ${unique}` },
    owner.id,
  );
  expect(world).toMatchObject({
    role: "owner",
    facilitator: { source: "human", membership_id: world.membership_id },
    current_play_role: "facilitator",
    play_status: "waiting-for-character",
  });

  const delegateWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    delegate.id,
    "player",
  );
  const editorWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    editor.id,
    "editor",
  );
  const character = await postJSON<EntityResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/entities`,
    {
      display_name: `Owner Character ${unique}`,
      controller_world_membership_ids: [world.membership_id],
    },
    owner.id,
  );
  expect(character.character_status).toBe("ready");

  const delegated = await putJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
    {
      source: "human",
      membership_id: delegateWorld.membership_id,
      expected_revision: world.revision,
    },
    owner.id,
  );
  expect(delegated).toMatchObject({
    role: "owner",
    revision: world.revision + 1,
    facilitator: {
      source: "human",
      membership_id: delegateWorld.membership_id,
    },
    current_play_role: "player",
    play_status: "ready",
  });
  expect(
    await getJSON<WorldResponse>(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}`,
      delegate.id,
    ),
  ).toMatchObject({
    role: "player",
    facilitator: {
      source: "human",
      membership_id: delegateWorld.membership_id,
    },
    current_play_role: "facilitator",
    play_status: "waiting-for-character",
  });
  await expectMemberRoles(request, baseURL, world.id, owner.id, [
    {
      id: world.membership_id,
      role: "owner",
      current_play_role: "player",
    },
    {
      id: delegateWorld.membership_id,
      role: "player",
      current_play_role: "facilitator",
    },
    {
      id: editorWorld.membership_id,
      role: "editor",
      current_play_role: "player",
    },
  ]);

  const humanInteraction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions`,
    {
      present: true,
      prompt: `The delegated facilitator asks the owner to act ${unique}.`,
      audience_membership_ids: [world.membership_id],
      eligible_responder_membership_ids: [world.membership_id],
      context_entity_ids: [character.id],
    },
    delegate.id,
  );
  expect(humanInteraction).toMatchObject({
    status: "open",
    facilitator_source: "human",
    eligible_responder_membership_ids: [world.membership_id],
  });
  const ownerAction = await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${humanInteraction.id}/actions`,
    {
      text: `The owner acts as a ready current player ${unique}.`,
      acting_entity_id: character.id,
      expected_revision: humanInteraction.revision,
    },
    owner.id,
  );
  expect(ownerAction).toMatchObject({
    submitted_by_membership_id: world.membership_id,
    status: "submitted",
  });

  await expectAPIError(
    await putAs(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
      {
        source: "human",
        membership_id: world.membership_id,
        expected_revision: delegated.revision,
      },
      delegate.id,
    ),
    409,
    "interactions_unfinished",
  );
  const currentHumanInteraction = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${humanInteraction.id}`,
    delegate.id,
  );
  await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${humanInteraction.id}/cancel`,
    { expected_revision: currentHumanInteraction.revision },
    delegate.id,
  );

  const terraWorld = await putJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
    { source: "terra", expected_revision: delegated.revision },
    owner.id,
  );
  expect(terraWorld).toMatchObject({
    role: "owner",
    facilitator: { source: "terra" },
    current_play_role: "player",
    play_status: "ready",
    revision: delegated.revision + 1,
  });
  expect(terraWorld.facilitator.membership_id).toBeUndefined();
  await expectMemberRoles(request, baseURL, world.id, owner.id, [
    {
      id: world.membership_id,
      role: "owner",
      current_play_role: "player",
    },
    {
      id: delegateWorld.membership_id,
      role: "player",
      current_play_role: "player",
    },
    {
      id: editorWorld.membership_id,
      role: "editor",
      current_play_role: "player",
    },
  ]);

  const terraInteraction = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/terra/continue`,
    undefined,
    owner.id,
  );
  expect(terraInteraction).toMatchObject({
    facilitator_source: "terra",
    status: "open",
    eligible_responder_membership_ids: [world.membership_id],
  });
  const terraAction = await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${terraInteraction.id}/actions`,
    {
      text: `${TERRA_MODEL_FAILURE_MARKER} The owner braces the crossing.`,
      acting_entity_id: character.id,
      expected_revision: terraInteraction.revision,
    },
    owner.id,
  );
  const terraReadyToDecide = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${terraInteraction.id}`,
    owner.id,
  );
  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/interactions/${terraInteraction.id}/terra/decide`,
      {
        expected_revision: terraReadyToDecide.revision,
        expected_rules_revision: terraWorld.rules_revision,
        idempotency_key: randomUUID(),
      },
      owner.id,
    ),
    502,
    "model_failed",
  );
  const terraAdjudicating = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${terraInteraction.id}`,
    owner.id,
  );
  expect(terraAdjudicating).toMatchObject({
    facilitator_source: "terra",
    status: "adjudicating",
    actions: [
      {
        id: terraAction.id,
        submitted_by_membership_id: world.membership_id,
        status: "submitted",
      },
    ],
  });
  for (const denied of [
    {
      actorID: owner.id,
      membershipID: delegateWorld.membership_id,
      label: "owner assigning another member",
    },
    {
      actorID: editor.id,
      membershipID: editorWorld.membership_id,
      label: "editor assigning themself",
    },
  ]) {
    await test.step(`unfinished Terra adjudication blocks ${denied.label}`, async () => {
      await expectAPIError(
        await putAs(
          request,
          `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
          {
            source: "human",
            membership_id: denied.membershipID,
            expected_revision: terraWorld.revision,
          },
          denied.actorID,
        ),
        409,
        "interactions_unfinished",
      );
    });
  }

  const recovered = await putJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
    {
      source: "human",
      membership_id: world.membership_id,
      expected_revision: terraWorld.revision,
    },
    owner.id,
  );
  expect(recovered).toMatchObject({
    role: "owner",
    facilitator: { source: "human", membership_id: world.membership_id },
    current_play_role: "facilitator",
    play_status: "ready",
    revision: terraWorld.revision + 1,
  });
  const recoveredInteraction = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${terraInteraction.id}`,
    owner.id,
  );
  expect(recoveredInteraction).toMatchObject({
    facilitator_source: "terra",
    status: "adjudicating",
    actions: [
      {
        id: terraAction.id,
        submitted_by_membership_id: world.membership_id,
        status: "withdrawn",
        revision: terraAction.revision + 1,
      },
    ],
  });
  await expectMemberRoles(request, baseURL, world.id, owner.id, [
    {
      id: world.membership_id,
      role: "owner",
      current_play_role: "facilitator",
    },
    {
      id: delegateWorld.membership_id,
      role: "player",
      current_play_role: "player",
    },
    {
      id: editorWorld.membership_id,
      role: "editor",
      current_play_role: "player",
    },
  ]);
});

test("contract: a ready current player can skip open and adjudicating Terra problems", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const owner = await signupActor(baseURL, `Skip Owner ${unique}`);
  const player = await signupActor(baseURL, `Skip Player ${unique}`);
  const world = await postJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds`,
    { name: `Terra Skip Contract ${unique}` },
    owner.id,
  );
  const playerWorld = await joinWorld(
    request,
    baseURL,
    world.id,
    owner.id,
    player.id,
    "player",
  );
  const character = await postJSON<EntityResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/entities`,
    {
      display_name: `Skip Character ${unique}`,
      controller_world_membership_ids: [playerWorld.membership_id],
    },
    owner.id,
  );

  const draft = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions`,
    {
      prompt: `Unpresented draft ${unique}`,
      private_notes: `Private draft notes ${unique}`,
      audience_membership_ids: [playerWorld.membership_id],
      eligible_responder_membership_ids: [playerWorld.membership_id],
      context_entity_ids: [character.id],
    },
    owner.id,
  );
  await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${draft.id}/cancel`,
    { expected_revision: draft.revision },
    owner.id,
  );
  await expectAPIError(
    await getAs(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/interactions/${draft.id}`,
      player.id,
    ),
    404,
    "not_found",
  );

  const terraWorld = await putJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/facilitator`,
    { source: "terra", expected_revision: world.revision },
    owner.id,
  );
  const open = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/terra/continue`,
    undefined,
    player.id,
  );
  const cancelledOpen = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${open.id}/cancel`,
    { expected_revision: open.revision },
    player.id,
  );
  expect(cancelledOpen).toMatchObject({
    id: open.id,
    facilitator_source: "terra",
    status: "cancelled",
    revision: open.revision + 1,
  });
  expect(
    await getJSON<InteractionResponse>(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/interactions/${open.id}`,
      player.id,
    ),
  ).toMatchObject({
    id: open.id,
    facilitator_source: "terra",
    status: "cancelled",
  });

  const next = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/terra/continue`,
    undefined,
    player.id,
  );
  await postJSON<InteractionActionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${next.id}/actions`,
    {
      text: `${TERRA_MODEL_FAILURE_MARKER} The player waits for Terra.`,
      acting_entity_id: character.id,
      expected_revision: next.revision,
    },
    player.id,
  );
  const readyToDecide = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${next.id}`,
    player.id,
  );
  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/wrought/api/worlds/${world.id}/interactions/${next.id}/terra/decide`,
      {
        expected_revision: readyToDecide.revision,
        expected_rules_revision: terraWorld.rules_revision,
        idempotency_key: randomUUID(),
      },
      player.id,
    ),
    502,
    "model_failed",
  );
  const adjudicating = await getJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${next.id}`,
    player.id,
  );
  expect(adjudicating.status).toBe("adjudicating");
  const cancelledAdjudicating = await postJSON<InteractionResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions/${next.id}/cancel`,
    { expected_revision: adjudicating.revision },
    player.id,
  );
  expect(cancelledAdjudicating).toMatchObject({
    id: next.id,
    facilitator_source: "terra",
    status: "cancelled",
    revision: adjudicating.revision + 1,
  });

  const history = await getJSON<InteractionResponse[]>(
    request,
    `${baseURL}/wrought/api/worlds/${world.id}/interactions`,
    player.id,
  );
  expect(history.map((item) => item.id)).not.toContain(draft.id);
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: open.id, status: "cancelled" }),
      expect.objectContaining({ id: next.id, status: "cancelled" }),
    ]),
  );
});

async function joinWorld(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  inviterID: string,
  joiningActorID: string,
  role: InviteResponse["role"],
): Promise<WorldResponse> {
  const invite = await postJSON<InviteResponse>(
    request,
    `${baseURL}/wrought/api/worlds/${worldID}/invites`,
    { role, expires_in_days: 7 },
    inviterID,
  );
  const token = invite.join_path?.split("/").at(-1);
  if (token === undefined || token === "") {
    throw new Error("created invitation has no bearer token");
  }
  return postJSON<WorldResponse>(
    request,
    `${baseURL}/wrought/api/world-invites/${token}/redeem`,
    undefined,
    joiningActorID,
  );
}

async function expectMemberRoles(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  actorID: string,
  expected: Array<
    Pick<WorldMemberResponse, "id" | "role" | "current_play_role">
  >,
): Promise<void> {
  const members = await getJSON<WorldMemberResponse[]>(
    request,
    `${baseURL}/wrought/api/worlds/${worldID}/members`,
    actorID,
  );
  for (const item of expected) {
    expect(members).toContainEqual(expect.objectContaining(item));
  }
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await getAs(request, url, actorID), url);
}

async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await postAs(request, url, data, actorID), url);
}

async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID: string,
): Promise<T> {
  return expectJSON<T>(await putAs(request, url, data, actorID), url);
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
  expect(JSON.parse(body)).toMatchObject({ error: { code } });
}
