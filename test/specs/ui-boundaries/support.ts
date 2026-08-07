import type { APIRequestContext, APIResponse, Page } from "@playwright/test";

import { sanitizeDiagnosticBody } from "../../src/scenario/evidence/redaction";

export interface IdentifiedResource {
  id: string;
}

export interface User extends IdentifiedResource {
  display_name: string;
}

export interface World extends IdentifiedResource {
  name: string;
  revision: number;
  rules_revision: number;
  table_revision: number;
  membership_id: string;
  play_status: "waiting-for-character" | "setup-required" | "ready";
}

export interface WorldMember extends World {
  role: "owner" | "editor" | "player" | "spectator";
}

export interface Invite extends IdentifiedResource {
  join_path: string;
}

export interface CharacterFieldSet {
  revision: number;
  fields: Array<{
    id: string;
    label: string;
    help_text?: string;
    visibility: "table" | "controllers-and-facilitators";
  }>;
}

export interface MechanicMutation {
  revision: number;
  mechanic: {
    id: string;
    name: string;
    archived: boolean;
  };
}

export interface Entity extends IdentifiedResource {
  display_name: string;
  character_status: "not-controlled" | "setup-required" | "ready";
  state: {
    revision: number;
    rules_revision: number;
  };
}

export interface EntityProfile {
  revision: number;
  character_fields_revision: number;
  fields: Array<{ id: string; label: string; value?: string }>;
}

export interface Interaction extends IdentifiedResource {
  revision: number;
  status: "draft" | "open" | "adjudicating" | "resolved" | "cancelled";
}

export interface InteractionAction extends IdentifiedResource {
  revision: number;
  status: "submitted" | "withdrawn" | "selected" | "declined";
}

export function identityHeaders(userID: string): Record<string, string> {
  return { "X-DND-User-ID": userID };
}

export async function createUser(
  request: APIRequestContext,
  baseURL: string,
  displayName: string,
): Promise<User> {
  return postJSON<User>(request, `${baseURL}/api/users`, {
    display_name: displayName,
  });
}

export async function createWorld(
  request: APIRequestContext,
  baseURL: string,
  ownerID: string,
  name: string,
): Promise<World> {
  return postJSON<World>(request, `${baseURL}/api/worlds`, { name }, ownerID);
}

export async function createInvite(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  authorID: string,
  role: "editor" | "player" | "spectator",
): Promise<Invite> {
  return postJSON<Invite>(
    request,
    `${baseURL}/api/worlds/${worldID}/invites`,
    { role, expires_in_days: 1 },
    authorID,
  );
}

export async function joinWorld(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  userID: string,
  role: "editor" | "player" | "spectator",
): Promise<WorldMember> {
  const invite = await createInvite(request, baseURL, worldID, ownerID, role);
  const token = required(invite.join_path.split("/").at(-1), "invite token");
  return postJSON<WorldMember>(
    request,
    `${baseURL}/api/world-invites/${token}/redeem`,
    undefined,
    userID,
  );
}

export async function putCharacterFields(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  expectedRevision: number,
  fields: Array<{
    id?: string;
    label: string;
    help_text?: string;
    visibility: "table" | "controllers-and-facilitators";
  }>,
): Promise<CharacterFieldSet> {
  return putJSON<CharacterFieldSet>(
    request,
    `${baseURL}/api/worlds/${worldID}/character-fields`,
    { expected_revision: expectedRevision, fields },
    ownerID,
  );
}

export async function createEntity(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  displayName: string,
  controllerMembershipIDs: readonly string[] = [],
): Promise<Entity> {
  return postJSON<Entity>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities`,
    {
      display_name: displayName,
      controller_world_membership_ids: controllerMembershipIDs,
    },
    ownerID,
  );
}

export async function replaceControllers(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  ownerID: string,
  expectedTableRevision: number,
  controllerMembershipIDs: readonly string[],
): Promise<void> {
  await putJSON(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/controllers`,
    {
      expected_table_revision: expectedTableRevision,
      controller_world_membership_ids: controllerMembershipIDs,
    },
    ownerID,
  );
}

export async function readProfile(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  actorID: string,
): Promise<EntityProfile> {
  return getJSON<EntityProfile>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    actorID,
  );
}

export async function putProfile(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  entityID: string,
  actorID: string,
  profile: EntityProfile,
  values: Array<{ field_id: string; value: string }>,
): Promise<EntityProfile> {
  return putJSON<EntityProfile>(
    request,
    `${baseURL}/api/worlds/${worldID}/entities/${entityID}/profile`,
    {
      expected_revision: profile.revision,
      expected_character_fields_revision: profile.character_fields_revision,
      values,
    },
    actorID,
  );
}

export async function createInputMechanic(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  name: string,
  expectedRulesRevision: number,
): Promise<MechanicMutation> {
  return postJSON<MechanicMutation>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    {
      kind: "capacity",
      mode: "score",
      source_kind: "input",
      name,
      default_number: 5,
      step: 1,
      mutable_during_play: true,
      archived: false,
      expected_rules_revision: expectedRulesRevision,
    },
    ownerID,
  );
}

export async function createDerivedMechanic(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  name: string,
  referencedMechanicID: string,
  expectedRulesRevision: number,
): Promise<MechanicMutation> {
  return postJSON<MechanicMutation>(
    request,
    `${baseURL}/api/worlds/${worldID}/mechanics`,
    {
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
    },
    ownerID,
  );
}

export async function createOpenInteraction(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  ownerID: string,
  prompt: string,
  responderMembershipIDs: readonly string[] = [],
  entityIDs: readonly string[] = [],
): Promise<Interaction> {
  return postJSON<Interaction>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions`,
    {
      present: true,
      prompt,
      eligible_responder_membership_ids: responderMembershipIDs,
      entity_ids: entityIDs,
    },
    ownerID,
  );
}

export async function postAction(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  interaction: Interaction,
  playerID: string,
  text: string,
  actingEntityID?: string,
): Promise<InteractionAction> {
  return postJSON<InteractionAction>(
    request,
    `${baseURL}/api/worlds/${worldID}/interactions/${interaction.id}/actions`,
    {
      text,
      expected_revision: interaction.revision,
      ...(actingEntityID === undefined
        ? {}
        : { acting_entity_id: actingEntityID }),
    },
    playerID,
  );
}

export async function readWorld(
  request: APIRequestContext,
  baseURL: string,
  worldID: string,
  actorID: string,
): Promise<World> {
  return getJSON<World>(request, `${baseURL}/api/worlds/${worldID}`, actorID);
}

export async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  actorID?: string,
): Promise<T> {
  const response = await request.get(url, {
    ...(actorID === undefined ? {} : { headers: identityHeaders(actorID) }),
  });
  return expectJSON<T>(response, url);
}

export async function postJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<T> {
  const response = await request.post(url, {
    ...(data === undefined ? {} : { data }),
    ...(actorID === undefined ? {} : { headers: identityHeaders(actorID) }),
  });
  return expectJSON<T>(response, url);
}

export async function putJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<T> {
  const response = await request.put(url, {
    data,
    ...(actorID === undefined ? {} : { headers: identityHeaders(actorID) }),
  });
  return expectJSON<T>(response, url);
}

export async function patchJSON<T>(
  request: APIRequestContext,
  url: string,
  data: unknown,
  actorID?: string,
): Promise<T> {
  const response = await request.patch(url, {
    data,
    ...(actorID === undefined ? {} : { headers: identityHeaders(actorID) }),
  });
  return expectJSON<T>(response, url);
}

export async function expectJSON<T>(
  response: APIResponse,
  label: string,
): Promise<T> {
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(
      `${response.status()} ${label}: ${sanitizeDiagnosticBody(body)}`,
    );
  }
  return JSON.parse(body) as T;
}

export async function openAs(
  page: Page,
  baseURL: string,
  path: string,
  displayName: string,
): Promise<void> {
  await page.goto(`${baseURL}${path}`);
  const identity = page.getByRole("button", {
    name: new RegExp(escapeRegExp(displayName)),
  });
  if (await identity.isVisible()) await identity.click();
}

export function acceptNextDialog(page: Page): void {
  page.once("dialog", async (dialog) => dialog.accept());
}

export function dismissNextDialog(page: Page): void {
  page.once("dialog", async (dialog) => dialog.dismiss());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`${label} is required`);
  return value;
}
