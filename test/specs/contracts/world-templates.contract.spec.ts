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
  disposeAuthenticatedActors,
  getAs,
  postAs,
  signupActor,
} from "../support/auth";

test.afterEach(async () => disposeAuthenticatedActors());

type MechanicValue =
  { kind: "number"; value: string } | { kind: "boolean"; value: boolean };

interface WorldTemplateResponse {
  id: string;
  name: string;
  description: string;
  setting: string;
  prose_guide: string;
  character_count: number;
  version: number;
}

interface WorldResponse {
  id: string;
  name: string;
  description?: string;
  prose_guide?: string;
  facilitator: {
    source: "human" | "terra" | "agent";
    membership_id?: string;
  };
  current_play_role: "facilitator" | "player" | "spectator";
  status: "active" | "archived";
  revision: number;
  roster_revision: number;
  rules_revision: number;
  role: "owner" | "editor" | "player" | "spectator";
  membership_id: string;
  member_count: number;
  capacity_count: number;
  capability_count: number;
  character_field_count: number;
  play_status:
    "waiting-for-character" | "setup-required" | "ready" | "unavailable";
}

interface Expression {
  operation: string;
  mechanic_id?: string;
  value?: MechanicValue;
  operands?: Expression[];
}

interface MechanicResponse {
  id: string;
  kind: "capacity" | "capability";
  mode: "pool" | "score" | "rating" | "binary";
  source_kind: "input" | "derived";
  name: string;
  description?: string;
  minimum?: string;
  maximum?: string;
  step?: string;
  default_number?: string;
  mutable_during_play: boolean;
  expression?: Expression;
  archived: boolean;
}

interface MechanicCollectionResponse {
  revision: number;
  mechanics: MechanicResponse[];
}

interface CharacterFieldSetResponse {
  revision: number;
  fields: Array<{
    id: string;
    label: string;
    visibility: "world" | "restricted";
  }>;
}

interface EntitySheetResponse {
  entity_id: string;
  logical_state_revision: number;
  status_set_revision: number;
  rules_revision: number;
  logical_input_values: Record<string, MechanicValue>;
  effective_values: Record<string, MechanicValue>;
  evaluations: Record<string, unknown>;
  active_status_instances: unknown[];
  authored_default_input_mechanic_ids: string[];
}

interface EntityResponse {
  id: string;
  display_name: string;
  archived: boolean;
  character_status: "not-controlled" | "setup-required" | "ready";
  required_field_count: number;
  completed_field_count: number;
  sheet: EntitySheetResponse;
}

interface EntityProfileResponse {
  entity_id: string;
  character_field_set_revision: number;
  character_status: "not-controlled" | "setup-required" | "ready";
  required_field_count: number;
  completed_field_count: number;
  missing_field_ids?: string[];
  can_edit: boolean;
  fields: Array<{
    id: string;
    label: string;
    visibility: "world" | "restricted";
    value?: string;
  }>;
}

interface AvailableEntitiesResponse {
  roster_revision: number;
  entities: Array<{
    id: string;
    display_name: string;
    profile_summary?: string;
  }>;
}

interface ClaimedWorldEntityResponse {
  entity_id: string;
  controller_world_membership_ids: string[];
  roster_revision: number;
  play_status: WorldResponse["play_status"];
}

interface ExpectedMechanic {
  name: string;
  kind: MechanicResponse["kind"];
  mode: MechanicResponse["mode"];
  source_kind: MechanicResponse["source_kind"];
  mutable_during_play: boolean;
  minimum?: string;
  maximum?: string;
  step?: string;
  default_number?: string;
  expression_operation?: string;
}

interface ExpectedEntity {
  name: string;
  inputs: Record<string, string | boolean>;
  derived: Record<string, string>;
}

interface ExpectedTemplate {
  id: string;
  name: string;
  description: string;
  setting: string;
  proseGuide: string;
  description_marker: string;
  mechanics: ExpectedMechanic[];
  fields: Array<{
    label: string;
    visibility: "world" | "restricted";
  }>;
  entities: ExpectedEntity[];
}

const templates: ExpectedTemplate[] = [
  {
    id: "banners-at-eldermead",
    name: "Banners at Eldermead",
    description:
      "War is closing around a village outside a vital trade city, and the reputations of five ordinary villagers may decide whom their neighbors trust.",
    setting: "Medieval fantasy",
    proseGuide:
      "Tell Eldermead in plain, grave language, with the weight of an old tale and the closeness of village life. Favor work, weather, food, animals, roads, tools, faces, and what people owe one another. Let large politics enter through specific demands made on households. Keep wonder spare and matter-of-fact. Avoid heroic bombast and decorative archaic speech. Let the cost of a choice reveal its meaning.",
    description_marker: "The Writ at Sundown",
    mechanics: [
      inputMechanic("Vigor", "capacity", "pool", true, "0", "5", "3"),
      inputMechanic("Nerve", "capacity", "pool", true, "0", "5", "3"),
      derivedMechanic("Sway", "capacity", "score", "add-number"),
      inputMechanic("Standing", "capability", "rating", true, "-2", "3", "0"),
      inputMechanic("Steel", "capability", "rating", false, "0", "3", "1"),
      inputMechanic("Cunning", "capability", "rating", false, "0", "3", "1"),
      inputMechanic("Lore", "capability", "rating", false, "0", "3", "1"),
    ],
    fields: [
      worldField("Place and bearing"),
      worldField("Reputation"),
      worldField("Bonds and obligations"),
      worldField("Gear and keepsakes"),
      restrictedField("Unspoken compromise"),
    ],
    entities: [
      numericEntity(
        "Renn Alder",
        [
          ["Vigor", "4"],
          ["Nerve", "3"],
          ["Standing", "2"],
          ["Steel", "1"],
          ["Cunning", "1"],
          ["Lore", "1"],
        ],
        [["Sway", "3"]],
      ),
      numericEntity(
        "Ysra Fen",
        [
          ["Vigor", "2"],
          ["Nerve", "4"],
          ["Standing", "0"],
          ["Steel", "0"],
          ["Cunning", "2"],
          ["Lore", "3"],
        ],
        [["Sway", "3"]],
      ),
      numericEntity(
        "Corven Saye",
        [
          ["Vigor", "3"],
          ["Nerve", "3"],
          ["Standing", "-2"],
          ["Steel", "1"],
          ["Cunning", "3"],
          ["Lore", "1"],
        ],
        [["Sway", "1"]],
      ),
      numericEntity(
        "Maelin Thorn",
        [
          ["Vigor", "4"],
          ["Nerve", "4"],
          ["Standing", "1"],
          ["Steel", "3"],
          ["Cunning", "0"],
          ["Lore", "1"],
        ],
        [["Sway", "2"]],
      ),
      numericEntity(
        "Sella Holt",
        [
          ["Vigor", "3"],
          ["Nerve", "3"],
          ["Standing", "1"],
          ["Steel", "0"],
          ["Cunning", "2"],
          ["Lore", "2"],
        ],
        [["Sway", "3"]],
      ),
    ],
  },
  {
    id: "the-courtesy-season",
    name: "The Courtesy Season",
    description:
      "Bellwether has eliminated scarcity beautifully, but five privileged insiders are beginning to see whose sleep, memory, and civic future pay for their comfort.",
    setting: "Utopian/dystopian cyberpunk",
    proseGuide:
      "Tell Bellwether in cool, exact prose. Stay close to bodies, rooms, clothing, weather, and small breaches of manners. Let the city speak in immaculate euphemisms through displays and officials, but let the narrator use ordinary words. A threat first appears as a pause, a hand withdrawn, a door that does not open. Keep the sentences controlled, shortening them when courtesy becomes danger. Trust the reader to understand the cruelty without explaining it.",
    description_marker: "Season's First Supper",
    mechanics: [
      inputMechanic("Favors", "capacity", "pool", true, "0", "6", "3"),
      inputMechanic("Composure", "capacity", "pool", true, "0", "6", "4"),
      inputMechanic("Civic Exposure", "capacity", "pool", true, "0", "6", "1"),
      derivedMechanic("Latitude", "capacity", "score", "max-number"),
      inputMechanic("Bearing", "capability", "rating", false, "0", "5", "3"),
      inputMechanic(
        "Systems Fluency",
        "capability",
        "rating",
        false,
        "0",
        "5",
        "2",
      ),
      {
        name: "Courtesy Filter",
        kind: "capability",
        mode: "binary",
        source_kind: "input",
        mutable_during_play: true,
      },
    ],
    fields: [
      worldField("Place at the Table"),
      worldField("Public Reputation"),
      worldField("Signature Alteration"),
      worldField("Unfashionable Attachment"),
      restrictedField("Cost of Comfort"),
      restrictedField("Memory the Mesh Rejects"),
    ],
    entities: [
      courtesyEntity("Mara Lysen", ["5", "2", "5", "3", "1", true], "9"),
      courtesyEntity("Ivo Senn", ["4", "4", "3", "2", "3", false], "4"),
      courtesyEntity("Nia Corven", ["5", "3", "6", "4", "2", true], "9"),
      courtesyEntity("Dr. Samira Ro", ["3", "5", "4", "5", "2", true], "5"),
      courtesyEntity("Felix Ansel", ["2", "5", "2", "4", "4", false], "0"),
    ],
  },
  {
    id: "terms-of-the-city",
    name: "Terms of the City",
    description:
      "Across present-day New York, unrelated words and media begin to seem personally addressed, and five ordinary people must decide what can actually be tested.",
    setting: "Contemporary New York mystery",
    proseGuide:
      "Tell New York with alert, unsentimental precision. Use ordinary contemporary words, exact times and places, fragments of institutional language, and the friction of work, transit, devices, rent, and obligation. Quote what screens and recordings show. Distinguish observation from inference through the order of sentences rather than analytical labels. Keep the narrator calm. Let unease arise from repetition, timing, and contradiction rather than ominous declarations.",
    description_marker: "The Line Beneath the Line",
    mechanics: [
      inputMechanic("Bandwidth", "capacity", "pool", true, "0", "5", "3"),
      inputMechanic("Exposure", "capacity", "pool", true, "0", "6", "0"),
      derivedMechanic("Room to Move", "capacity", "score", "max-number"),
      inputMechanic("Standing", "capability", "rating", true, "0", "4", "2"),
      inputMechanic("Access", "capability", "rating", true, "0", "4", "2"),
    ],
    fields: [
      worldField("Public face"),
      worldField("Tether tonight"),
      worldField("First wrong note"),
      worldField("Hard boundary"),
    ],
    entities: [
      cityEntity("Lena Ortiz", ["3", "3", "4", "1"], "6"),
      cityEntity("Andre Bell", ["4", "2", "3", "0"], "5"),
      cityEntity("Priya Shah", ["3", "4", "4", "2"], "6"),
      cityEntity("Micah Reed", ["4", "1", "3", "3"], "1"),
      cityEntity("Ruth Park", ["3", "4", "3", "1"], "6"),
    ],
  },
];

test("contract: the three World templates clone atomically into complete, playable Worlds", async ({
  request,
}) => {
  test.setTimeout(30_000);
  const baseURL = await readBaseURL();
  const owner = await signupActor(
    baseURL,
    `Template Owner ${randomUUID().slice(0, 8)}`,
  );

  await test.step("the authenticated catalog exposes exactly the three equal choices", async () => {
    const catalog = await getJSON<WorldTemplateResponse[]>(
      request,
      `${baseURL}/api/world-templates`,
      owner.id,
    );
    expect(catalog).toHaveLength(3);
    expect([...catalog].sort(byID)).toEqual(
      templates
        .map(({ id, name, description, setting, proseGuide }) => ({
          id,
          name,
          description,
          setting,
          prose_guide: proseGuide,
          character_count: 5,
          version: 2,
        }))
        .sort(byID),
    );
  });

  const copies = new Map<string, MaterializedCopy>();
  for (const expected of templates) {
    await test.step(`copy and inspect ${expected.name}`, async () => {
      const destinationID = randomUUID();
      const cloneURL = `${baseURL}/api/world-templates/${expected.id}/clone`;
      const response = await postAs(
        request,
        cloneURL,
        { id: destinationID },
        owner.id,
      );
      expect(response.headers().location).toBe(`/api/worlds/${destinationID}`);
      const world = await expectJSONStatus<WorldResponse>(
        response,
        201,
        cloneURL,
      );
      expect(world).toMatchObject({
        id: destinationID,
        name: expected.name,
        prose_guide: expected.proseGuide,
        facilitator: { source: "agent" },
        current_play_role: "player",
        status: "active",
        role: "owner",
        member_count: 1,
        capacity_count: expected.mechanics.filter(
          ({ kind }) => kind === "capacity",
        ).length,
        capability_count: expected.mechanics.filter(
          ({ kind }) => kind === "capability",
        ).length,
        character_field_count: expected.fields.length,
        play_status: "waiting-for-character",
      });
      expect(world.facilitator.membership_id).toBeUndefined();
      expect(world.description).toContain(expected.description_marker);

      const replay = await expectJSONStatus<WorldResponse>(
        await postAs(request, cloneURL, { id: destinationID }, owner.id),
        200,
        `${cloneURL} replay`,
      );
      expect(replay).toMatchObject({
        id: world.id,
        prose_guide: expected.proseGuide,
        membership_id: world.membership_id,
        rules_revision: world.rules_revision,
        roster_revision: world.roster_revision,
        play_status: "waiting-for-character",
      });

      copies.set(
        expected.id,
        await inspectMaterializedCopy(
          request,
          baseURL,
          owner.id,
          world,
          expected,
        ),
      );
    });
  }

  await test.step("claiming a complete preset makes Play ready", async () => {
    const copy = required(copies.get("terms-of-the-city"), "Terms copy");
    const chosen = required(copy.available.entities[0], "available Character");
    const claimURL = `${baseURL}/api/worlds/${copy.world.id}/entities/${chosen.id}/claim`;
    const claimed = await expectJSONStatus<ClaimedWorldEntityResponse>(
      await postAs(
        request,
        claimURL,
        { expected_roster_revision: copy.available.roster_revision },
        owner.id,
      ),
      200,
      claimURL,
    );
    expect(claimed).toMatchObject({
      entity_id: chosen.id,
      controller_world_membership_ids: [copy.world.membership_id],
      play_status: "ready",
    });
    expect(claimed.roster_revision).toBe(copy.available.roster_revision + 1);

    const readyWorld = await getJSON<WorldResponse>(
      request,
      `${baseURL}/api/worlds/${copy.world.id}`,
      owner.id,
    );
    expect(readyWorld).toMatchObject({
      current_play_role: "player",
      play_status: "ready",
      roster_revision: claimed.roster_revision,
    });
    const readyProfile = await getJSON<EntityProfileResponse>(
      request,
      `${baseURL}/api/worlds/${copy.world.id}/entities/${chosen.id}/profile`,
      owner.id,
    );
    expect(readyProfile.character_status).toBe("ready");
  });

  await test.step("an independent copy receives fresh mechanic, field, and Character IDs", async () => {
    const expected = required(
      templates.find(({ id }) => id === "banners-at-eldermead"),
      "Banners template",
    );
    const first = required(copies.get(expected.id), "first Banners copy");
    const destinationID = randomUUID();
    const cloneURL = `${baseURL}/api/world-templates/${expected.id}/clone`;
    const world = await expectJSONStatus<WorldResponse>(
      await postAs(request, cloneURL, { id: destinationID }, owner.id),
      201,
      cloneURL,
    );
    const second = await inspectMaterializedCopy(
      request,
      baseURL,
      owner.id,
      world,
      expected,
    );

    expect(second.world.id).not.toBe(first.world.id);
    expect(second.world.membership_id).not.toBe(first.world.membership_id);
    expect(intersection(first.mechanicIDs, second.mechanicIDs)).toEqual([]);
    expect(intersection(first.fieldIDs, second.fieldIDs)).toEqual([]);
    expect(intersection(first.entityIDs, second.entityIDs)).toEqual([]);
  });
});

test("contract: World template endpoints reject unauthenticated, unknown, and invalid requests", async ({
  request,
}) => {
  const baseURL = await readBaseURL();
  const owner = await signupActor(
    baseURL,
    `Template Errors ${randomUUID().slice(0, 8)}`,
  );

  await expectAPIError(
    await getAs(request, `${baseURL}/api/world-templates`),
    401,
    "authentication_required",
  );
  await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/world-templates/not-a-template/clone`,
      { id: randomUUID() },
      owner.id,
    ),
    404,
    "world_template_not_found",
  );
  const invalid = await expectAPIError(
    await postAs(
      request,
      `${baseURL}/api/world-templates/banners-at-eldermead/clone`,
      { id: "not-a-uuid" },
      owner.id,
    ),
    422,
    "validation_failed",
  );
  expect(invalid.error?.fields).toEqual({
    id: "a destination World UUID is required",
  });
});

interface MaterializedCopy {
  world: WorldResponse;
  mechanicIDs: Set<string>;
  fieldIDs: Set<string>;
  entityIDs: Set<string>;
  available: AvailableEntitiesResponse;
}

async function inspectMaterializedCopy(
  request: APIRequestContext,
  baseURL: string,
  actorID: string,
  world: WorldResponse,
  expected: ExpectedTemplate,
): Promise<MaterializedCopy> {
  const worldURL = `${baseURL}/api/worlds/${world.id}`;
  const [mechanics, fieldSet, entities, available] = await Promise.all([
    getJSON<MechanicCollectionResponse>(
      request,
      `${worldURL}/mechanics`,
      actorID,
    ),
    getJSON<CharacterFieldSetResponse>(
      request,
      `${worldURL}/character-fields`,
      actorID,
    ),
    getJSON<EntityResponse[]>(request, `${worldURL}/entities`, actorID),
    getJSON<AvailableEntitiesResponse>(
      request,
      `${worldURL}/available-entities`,
      actorID,
    ),
  ]);

  expect(mechanics.revision).toBe(world.rules_revision);
  expect(mechanics.mechanics).toHaveLength(expected.mechanics.length);
  expect(mechanics.mechanics.map(({ name }) => name)).toEqual(
    expected.mechanics.map(({ name }) => name),
  );
  const mechanicByName = new Map(
    mechanics.mechanics.map((mechanic) => [mechanic.name, mechanic]),
  );
  const mechanicIDs = new Set(mechanics.mechanics.map(({ id }) => id));
  expect(mechanicIDs.size).toBe(expected.mechanics.length);
  for (const definition of expected.mechanics) {
    const mechanic = required(
      mechanicByName.get(definition.name),
      definition.name,
    );
    expect(mechanic).toMatchObject({
      kind: definition.kind,
      mode: definition.mode,
      source_kind: definition.source_kind,
      mutable_during_play: definition.mutable_during_play,
      archived: false,
    });
    expect(mechanic.description?.trim().length).toBeGreaterThan(20);
    for (const key of [
      "minimum",
      "maximum",
      "step",
      "default_number",
    ] as const) {
      expect(mechanic[key], `${definition.name}.${key}`).toBe(definition[key]);
    }
    if (definition.expression_operation === undefined) {
      expect(mechanic.expression).toBeUndefined();
    } else {
      expect(mechanic.expression?.operation).toBe(
        definition.expression_operation,
      );
      const references = collectMechanicReferences(mechanic.expression);
      expect(references.length).toBeGreaterThan(0);
      expect(references.every((id) => mechanicIDs.has(id))).toBe(true);
    }
  }

  expect(
    fieldSet.fields.map(({ label, visibility }) => ({ label, visibility })),
  ).toEqual(expected.fields);
  const fieldIDs = new Set(fieldSet.fields.map(({ id }) => id));
  expect(fieldIDs.size).toBe(expected.fields.length);

  expect(entities).toHaveLength(5);
  expect(entities.map(({ display_name }) => display_name).sort()).toEqual(
    expected.entities.map(({ name }) => name).sort(),
  );
  const entityIDs = new Set(entities.map(({ id }) => id));
  expect(entityIDs.size).toBe(5);
  const entityByName = new Map(
    entities.map((entity) => [entity.display_name, entity]),
  );
  for (const expectedEntity of expected.entities) {
    const entity = required(
      entityByName.get(expectedEntity.name),
      expectedEntity.name,
    );
    expect(entity).toMatchObject({
      archived: false,
      character_status: "not-controlled",
      required_field_count: expected.fields.length,
      completed_field_count: expected.fields.length,
    });
    expect(entity.sheet).toMatchObject({
      entity_id: entity.id,
      rules_revision: mechanics.revision,
      active_status_instances: [],
    });
    const authoredDefaultIDs = Object.entries(expectedEntity.inputs)
      .filter(([name, value]) => {
        const definition = required(
          expected.mechanics.find((mechanic) => mechanic.name === name),
          `${expectedEntity.name}.${name} definition`,
        );
        return typeof value === "boolean"
          ? definition.mode === "binary" && value === false
          : definition.default_number === value;
      })
      .map(([name]) => required(mechanicByName.get(name), name).id)
      .sort();
    expect(entity.sheet.authored_default_input_mechanic_ids.sort()).toEqual(
      authoredDefaultIDs,
    );
    const expectedInputIDs = Object.keys(expectedEntity.inputs).map(
      (name) =>
        required(mechanicByName.get(name), `${expectedEntity.name}.${name}`).id,
    );
    expect(Object.keys(entity.sheet.logical_input_values).sort()).toEqual(
      expectedInputIDs.sort(),
    );
    for (const [name, value] of Object.entries(expectedEntity.inputs)) {
      const mechanicID = required(mechanicByName.get(name), name).id;
      expect(entity.sheet.logical_input_values[mechanicID]).toEqual(
        mechanicValue(value),
      );
      expect(entity.sheet.effective_values[mechanicID]).toEqual(
        mechanicValue(value),
      );
    }
    for (const [name, value] of Object.entries(expectedEntity.derived)) {
      const mechanicID = required(mechanicByName.get(name), name).id;
      expect(entity.sheet.effective_values[mechanicID]).toEqual(
        mechanicValue(value),
      );
    }
    expect(Object.keys(entity.sheet.effective_values).sort()).toEqual(
      [...mechanicIDs].sort(),
    );
    expect(Object.keys(entity.sheet.evaluations).sort()).toEqual(
      [...mechanicIDs].sort(),
    );
  }

  expect(available.roster_revision).toBe(world.roster_revision);
  expect(available.entities).toHaveLength(5);
  expect(
    available.entities.map(({ display_name }) => display_name).sort(),
  ).toEqual(expected.entities.map(({ name }) => name).sort());
  for (const availableEntity of available.entities) {
    expect(availableEntity.profile_summary?.trim().length).toBeGreaterThan(20);
  }

  const profiles = await Promise.all(
    entities.map((entity) =>
      getJSON<EntityProfileResponse>(
        request,
        `${worldURL}/entities/${entity.id}/profile`,
        actorID,
      ),
    ),
  );
  for (const profile of profiles) {
    expect(profile).toMatchObject({
      character_status: "not-controlled",
      required_field_count: expected.fields.length,
      completed_field_count: expected.fields.length,
      can_edit: true,
    });
    expect(profile.character_field_set_revision).toBe(fieldSet.revision);
    expect(profile.missing_field_ids ?? []).toEqual([]);
    expect(
      profile.fields.map(({ label, visibility }) => ({ label, visibility })),
    ).toEqual(expected.fields);
    expect(
      profile.fields.every(({ value }) => (value?.trim().length ?? 0) > 20),
    ).toBe(true);
  }

  return { world, mechanicIDs, fieldIDs, entityIDs, available };
}

function inputMechanic(
  name: string,
  kind: MechanicResponse["kind"],
  mode: MechanicResponse["mode"],
  mutableDuringPlay: boolean,
  minimum: string,
  maximum: string,
  defaultNumber: string,
): ExpectedMechanic {
  return {
    name,
    kind,
    mode,
    source_kind: "input",
    mutable_during_play: mutableDuringPlay,
    minimum,
    maximum,
    step: "1",
    default_number: defaultNumber,
  };
}

function derivedMechanic(
  name: string,
  kind: MechanicResponse["kind"],
  mode: MechanicResponse["mode"],
  expressionOperation: string,
): ExpectedMechanic {
  return {
    name,
    kind,
    mode,
    source_kind: "derived",
    mutable_during_play: false,
    expression_operation: expressionOperation,
  };
}

function worldField(label: string): ExpectedTemplate["fields"][number] {
  return { label, visibility: "world" };
}

function restrictedField(label: string): ExpectedTemplate["fields"][number] {
  return { label, visibility: "restricted" };
}

function numericEntity(
  name: string,
  inputs: Array<[string, string]>,
  derived: Array<[string, string]>,
): ExpectedEntity {
  return {
    name,
    inputs: Object.fromEntries(inputs),
    derived: Object.fromEntries(derived),
  };
}

function courtesyEntity(
  name: string,
  values: [string, string, string, string, string, boolean],
  latitude: string,
): ExpectedEntity {
  const [bearing, systems, favors, composure, exposure, filter] = values;
  return {
    name,
    inputs: {
      Bearing: bearing,
      "Systems Fluency": systems,
      Favors: favors,
      Composure: composure,
      "Civic Exposure": exposure,
      "Courtesy Filter": filter,
    },
    derived: { Latitude: latitude },
  };
}

function cityEntity(
  name: string,
  values: [string, string, string, string],
  roomToMove: string,
): ExpectedEntity {
  const [bandwidth, standing, access, exposure] = values;
  return {
    name,
    inputs: {
      Bandwidth: bandwidth,
      Standing: standing,
      Access: access,
      Exposure: exposure,
    },
    derived: { "Room to Move": roomToMove },
  };
}

function mechanicValue(value: string | boolean): MechanicValue {
  return typeof value === "boolean"
    ? { kind: "boolean", value }
    : { kind: "number", value };
}

function collectMechanicReferences(
  expression: Expression | undefined,
): string[] {
  if (expression === undefined) {
    return [];
  }
  return [
    ...(expression.mechanic_id === undefined ? [] : [expression.mechanic_id]),
    ...(expression.operands ?? []).flatMap(collectMechanicReferences),
  ];
}

function intersection(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((id) => right.has(id)).sort();
}

function byID(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

async function getJSON<T>(
  request: APIRequestContext,
  url: string,
  actorID: string,
): Promise<T> {
  return expectJSONStatus<T>(await getAs(request, url, actorID), 200, url);
}

async function expectJSONStatus<T>(
  response: APIResponse,
  status: number,
  label: string,
): Promise<T> {
  const body = await response.text();
  expect(
    response.status(),
    `${sanitizeURL(label)}: ${sanitizeDiagnosticBody(body)}`,
  ).toBe(status);
  return JSON.parse(body) as T;
}

interface APIErrorBody {
  error?: { code?: string; fields?: Record<string, string> };
}

async function expectAPIError(
  response: APIResponse,
  status: number,
  code: string,
): Promise<APIErrorBody> {
  const body = await response.text();
  expect(response.status(), sanitizeDiagnosticBody(body)).toBe(status);
  const decoded = JSON.parse(body) as APIErrorBody;
  expect(decoded.error?.code, sanitizeDiagnosticBody(body)).toBe(code);
  return decoded;
}
