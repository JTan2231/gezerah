import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../src/runtime";

interface RuleSetResponse {
  id: string;
  key: string;
  name: string;
}

interface WorldResponse {
  id: string;
  name: string;
  role: "owner" | "editor" | "player" | "spectator";
  capacity_count: number;
  capability_count: number;
  character_field_count: number;
}

interface WorldMechanicResponse {
  id: string;
  kind: "capacity" | "capability";
  mode: "score" | "pool" | "binary" | "rating";
  name: string;
}

interface WorldEntityResponse {
  id: string;
  display_name: string;
  state: StateResponse;
}

interface EntityResponse {
  id: string;
  key?: string;
}

interface VariableResponse {
  id: string;
  key: string;
}

interface OwnerSchemaResponse {
  id: string;
}

interface ProblemDefinitionResponse {
  id: string;
  choices: Array<{ id: string }>;
}

interface ProblemInstanceResponse {
  id: string;
  binding_revision: number;
  state_revision: number;
}

interface StateResponse {
  revision: number;
  values: Record<string, unknown>;
  defaulted_definition_ids: string[];
}

interface ResolutionResponse {
  status: "applied" | "unavailable" | "incomplete";
  preview?: boolean;
  binding_revision?: number;
  applied_effects: Array<{
    before?: unknown;
    after?: unknown;
    changed: boolean;
  }>;
  state?: {
    records: Record<string, StateResponse>;
  };
}

interface ConditionResponse {
  id: string;
  parameters: Array<{ id: string }>;
}

interface ConditionEvaluationResponse {
  status: "met" | "unmet" | "unknown";
  missing_values: Array<{
    entity_id: string;
    state_variable_id: string;
  }>;
}

test("an author creates a world whose entity sheets stem from capacities and capabilities", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const unique = randomUUID().slice(0, 8);
  const authorName = `World Author ${unique}`;
  await page.goto(`${baseURL}/worlds`);

  await expect(
    page.getByRole("heading", { name: "Who is opening the book?" }),
  ).toBeVisible();
  await page.getByLabel("Your display name").fill(authorName);
  await page.getByRole("button", { name: "Create local profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Where are we headed?" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create world" }).click();
  await page.getByLabel("World name").fill(`Ember Coast ${unique}`);
  await page
    .getByLabel("Short description")
    .fill("A rain-soaked frontier made at the table.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create world" })
    .click();
  await expect(page.getByRole("heading", { name: "Capacities" })).toBeVisible();

  await page.getByRole("button", { name: "New capacity" }).click();
  await page.getByLabel("Name").fill("Resolve");
  await page.getByLabel("Description").fill("Composure under pressure.");
  await page.getByRole("radio", { name: /Pool/ }).check();
  await page.getByLabel("Default").fill("8");
  await page.getByLabel("Minimum").fill("0");
  await page.getByLabel("Maximum").fill("12");
  await page.getByLabel("Step").fill("1");
  await page.getByLabel("Unit").fill("grit");
  await page.getByRole("button", { name: "Create capacity" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: /Capabilities/ }).click();
  await page.getByRole("button", { name: "New capability" }).click();
  await page.getByLabel("Name").fill("Climbing");
  await page
    .getByLabel("Description")
    .fill("Moving safely across steep or unstable ground.");
  await page.getByRole("button", { name: "Create capability" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: /Character fields/ }).click();
  await expect(
    page.getByRole("heading", { name: "Character fields", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add required field" }).click();
  await page.getByLabel("Field label").fill("Backstory");
  await page.getByLabel("Guidance").fill("Where did this character come from?");
  await page.getByRole("button", { name: "Publish requirements" }).click();
  await expect(page.getByText("schema r1")).toBeVisible();

  await page.getByRole("button", { name: /Enter play/ }).click();
  await expect(page.getByText("The table is listening")).toBeVisible();
  await page.getByRole("button", { name: "Create entity" }).first().click();
  await page.getByLabel("Display name").fill("Aria Vale");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create entity" })
    .click();
  await expect(page.getByRole("heading", { name: "Aria Vale" })).toBeVisible();
  await page.getByLabel("Resolve").fill("6");
  await page.getByLabel("Climbing").check();
  await page.getByRole("button", { name: "Save sheet" }).click();
  await expect(page.getByText("state r1")).toBeVisible();

  const authorID = await page.evaluate(
    () => localStorage.getItem("dnd.selected-user") ?? "",
  );
  expect(authorID).not.toBe("");
  const worlds = await getJSON<WorldResponse[]>(
    page,
    `${baseURL}/api/worlds`,
    authorID,
  );
  expect(worlds).toHaveLength(1);
  expect(worlds[0]).toMatchObject({
    role: "owner",
    capacity_count: 1,
    capability_count: 1,
    character_field_count: 1,
  });
  const world = worlds[0];
  expect(world).toBeDefined();
  const mechanics = await getJSON<WorldMechanicResponse[]>(
    page,
    `${baseURL}/api/worlds/${world?.id}/mechanics`,
    authorID,
  );
  expect(mechanics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "capacity",
        mode: "pool",
        name: "Resolve",
      }),
      expect.objectContaining({
        kind: "capability",
        mode: "binary",
        name: "Climbing",
      }),
    ]),
  );
  const entities = await getJSON<WorldEntityResponse[]>(
    page,
    `${baseURL}/api/worlds/${world?.id}/entities`,
    authorID,
  );
  const aria = entities.find((entity) => entity.display_name === "Aria Vale");
  const resolve = mechanics.find((mechanic) => mechanic.name === "Resolve");
  const climbing = mechanics.find((mechanic) => mechanic.name === "Climbing");
  expect(aria?.state.values[resolve?.id ?? ""]).toEqual({
    kind: "number",
    value: 6,
  });
  expect(aria?.state.values[climbing?.id ?? ""]).toEqual({
    kind: "boolean",
    value: true,
  });

  const outsider = await postJSON<{ id: string }>(
    page,
    `${baseURL}/api/users`,
    { display_name: `Outsider ${unique}` },
  );
  expect(
    await getJSON<WorldResponse[]>(page, `${baseURL}/api/worlds`, outsider.id),
  ).toEqual([]);
  const forbidden = await page.request.get(
    `${baseURL}/api/worlds/${world?.id}`,
    { headers: identityHeaders(outsider.id) },
  );
  expect(forbidden.status()).toBe(403);
});

test("preview is advisory and resolution atomically persists authored effects", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const ruleSet = await postJSON<RuleSetResponse>(
    page,
    `${baseURL}/api/rule-sets`,
    { key: "runtime-transitions", name: "Runtime Transitions" },
  );
  const ruleSetURL = `${baseURL}/api/rule-sets/${ruleSet.id}`;
  const schema = await postJSON<OwnerSchemaResponse>(
    page,
    `${ruleSetURL}/owner-schemas`,
    {
      key: "combatant",
      label: "Combatant",
      archived: false,
    },
  );
  const health = await postJSON<VariableResponse>(
    page,
    `${ruleSetURL}/state-variable-definitions`,
    {
      key: "core-health",
      label: "Health",
      owner_schema_ids: [schema.id],
      cardinality: "one",
      value_schema: {
        kind: "number",
        minimum: 0,
        maximum: 100,
        step: 1,
        unit: "hp",
      },
      missing_value: {
        kind: "default",
        value: { kind: "number", value: 100 },
        omit_when_stored: false,
      },
      condition_addressable: true,
      allowed_effect_operations: ["adjust-number"],
      display_order: 0,
      archived: false,
    },
  );

  const targetId = randomUUID();
  const choiceId = randomUUID();
  const problem = await postJSON<ProblemDefinitionResponse>(
    page,
    `${ruleSetURL}/problem-definitions`,
    {
      key: "take-damage",
      name: "Take damage",
      instance_owner_schema_ids: [schema.id],
      targets: [
        {
          id: targetId,
          key: "self",
          label: "Self",
          cardinality: "one",
          minimum_bindings: 1,
          maximum_bindings: 1,
          binding_source: "problem-instance",
          required_owner_schema_ids: [schema.id],
        },
      ],
      choices: [
        {
          id: choiceId,
          key: "take-ten",
          name: "Take ten damage",
          resolution: {
            type: "automatic",
            outcome: {
              id: randomUUID(),
              label: "Damage applied",
              consequences: {
                id: randomUUID(),
                effects: [
                  {
                    id: randomUUID(),
                    type: "adjust-number",
                    target_definition_id: targetId,
                    state_variable_id: health.id,
                    amount: -10,
                  },
                ],
              },
            },
          },
        },
      ],
      archived: false,
    },
  );
  expect(problem.choices[0]?.id).toBe(choiceId);

  const instance = await postJSON<ProblemInstanceResponse>(
    page,
    `${ruleSetURL}/problem-instances`,
    {
      problem_definition_id: problem.id,
      key: "training-dummy",
      display_name: "Training Dummy",
      bindings: [],
    },
  );
  expect(instance.binding_revision).toBe(0);
  expect(instance.state_revision).toBe(0);

  const initialState = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
  );
  expect(initialState.revision).toBe(0);
  expect(initialState.values[health.id]).toEqual({
    kind: "number",
    value: 100,
  });
  expect(initialState.defaulted_definition_ids).toContain(health.id);

  const operationURL = `${ruleSetURL}/problem-instances/${instance.id}/choices/${choiceId}`;
  const preview = await postJSON<ResolutionResponse>(
    page,
    `${operationURL}/preview`,
    { expected_binding_revision: 0 },
  );
  expect(preview.status).toBe("applied");
  expect(preview.preview).toBe(true);
  expect(preview.binding_revision).toBe(0);
  expect(preview.applied_effects).toEqual([
    expect.objectContaining({
      before: { kind: "number", value: 100 },
      after: { kind: "number", value: 90 },
      changed: true,
    }),
  ]);
  expect(preview.state?.records[instance.id]?.revision).toBe(0);

  const stateAfterAPIPreview = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
  );
  expect(stateAfterAPIPreview).toEqual(initialState);

  const applied = await postJSON<ResolutionResponse>(
    page,
    `${operationURL}/resolve`,
    {
      expected_binding_revision: 0,
      expected_state_revisions: { [instance.id]: 0 },
    },
  );
  expect(applied.status).toBe("applied");
  const resolvedState = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
  );
  expect(resolvedState.revision).toBe(1);
  expect(resolvedState.values[health.id]).toEqual({
    kind: "number",
    value: 90,
  });
  expect(resolvedState.defaulted_definition_ids).not.toContain(health.id);

  const staleResponse = await page.request.post(`${operationURL}/resolve`, {
    data: {
      expected_binding_revision: 0,
      expected_state_revisions: { [instance.id]: 0 },
    },
  });
  expect(staleResponse.status()).toBe(409);
  await expect(staleResponse.json()).resolves.toMatchObject({
    error: { code: "revision_conflict" },
  });
  const stateAfterConflict = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
  );
  expect(stateAfterConflict).toEqual(resolvedState);

  const defaultedState = await putJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
    { expected_revision: 1, values: {} },
  );
  expect(defaultedState.revision).toBe(2);
  expect(defaultedState.values[health.id]).toEqual({
    kind: "number",
    value: 100,
  });
  expect(defaultedState.defaulted_definition_ids).toContain(health.id);
});

test("conditions drive authoritative outcomes and invalid effects roll back", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  const ruleSet = await postJSON<RuleSetResponse>(
    page,
    `${baseURL}/api/rule-sets`,
    { key: "conditional-resolution", name: "Conditional Resolution" },
  );
  const ruleSetURL = `${baseURL}/api/rule-sets/${ruleSet.id}`;
  const schema = await postJSON<OwnerSchemaResponse>(
    page,
    `${ruleSetURL}/owner-schemas`,
    { key: "agent", label: "Agent", archived: false },
  );
  const readiness = await postJSON<VariableResponse>(
    page,
    `${ruleSetURL}/state-variable-definitions`,
    {
      key: "core-readiness",
      label: "Readiness",
      owner_schema_ids: [schema.id],
      cardinality: "one",
      value_schema: {
        kind: "number",
        minimum: 0,
        maximum: 3,
        step: 1,
      },
      missing_value: { kind: "unknown" },
      condition_addressable: true,
      allowed_effect_operations: ["adjust-number"],
      display_order: 0,
      archived: false,
    },
  );
  const subject = await postJSON<EntityResponse>(
    page,
    `${ruleSetURL}/entities`,
    {
      key: "subject",
      display_name: "Subject",
      owner_schema_ids: [schema.id],
      archived: false,
    },
  );

  const parameterId = randomUUID();
  const condition = await postJSON<ConditionResponse>(
    page,
    `${ruleSetURL}/condition-sets`,
    {
      key: "is-ready",
      name: "Is ready",
      parameters: [
        {
          id: parameterId,
          key: "subject",
          label: "Subject",
          cardinality: "one",
          required_owner_schema_ids: [schema.id],
        },
      ],
      root: {
        id: randomUUID(),
        type: "criterion",
        parameter_id: parameterId,
        quantifier: "single",
        state_variable_id: readiness.id,
        predicate: { kind: "number", operator: "gt", value: 0 },
      },
      archived: false,
    },
  );
  expect(condition.parameters[0]?.id).toBe(parameterId);

  const evaluationURL = `${ruleSetURL}/condition-sets/${condition.id}/evaluate`;
  const evaluate = () =>
    postJSON<ConditionEvaluationResponse>(page, evaluationURL, {
      arguments: [{ parameter_id: parameterId, entity_ids: [subject.id] }],
    });

  const unknown = await evaluate();
  expect(unknown.status).toBe("unknown");
  expect(unknown.missing_values).toEqual([
    { entity_id: subject.id, state_variable_id: readiness.id },
  ]);

  const subjectStateURL = `${ruleSetURL}/entities/${subject.id}/state`;
  const zeroState = await putJSON<StateResponse>(page, subjectStateURL, {
    expected_revision: 0,
    values: { [readiness.id]: { kind: "number", value: 0 } },
  });
  expect(zeroState.revision).toBe(1);
  expect((await evaluate()).status).toBe("unmet");

  const readyState = await putJSON<StateResponse>(page, subjectStateURL, {
    expected_revision: 1,
    values: { [readiness.id]: { kind: "number", value: 2 } },
  });
  expect(readyState.revision).toBe(2);
  expect((await evaluate()).status).toBe("met");

  const targetId = randomUUID();
  const choiceId = randomUUID();
  const problem = await postJSON<ProblemDefinitionResponse>(
    page,
    `${ruleSetURL}/problem-definitions`,
    {
      key: "attempt-action",
      name: "Attempt action",
      instance_owner_schema_ids: [],
      targets: [
        {
          id: targetId,
          key: "subject",
          label: "Subject",
          cardinality: "one",
          minimum_bindings: 1,
          maximum_bindings: 1,
          binding_source: "supplied",
          required_owner_schema_ids: [schema.id],
        },
      ],
      choices: [
        {
          id: choiceId,
          key: "try",
          name: "Try",
          resolution: {
            type: "condition",
            invocation: {
              id: randomUUID(),
              condition_set_id: condition.id,
              arguments: [
                {
                  parameter_id: parameterId,
                  target_definition_id: targetId,
                },
              ],
            },
            met: {
              id: randomUUID(),
              label: "Succeeded",
              consequences: {
                id: randomUUID(),
                effects: [
                  {
                    id: randomUUID(),
                    type: "adjust-number",
                    target_definition_id: targetId,
                    state_variable_id: readiness.id,
                    amount: 1,
                  },
                ],
              },
            },
            unmet: {
              id: randomUUID(),
              label: "Failed",
              consequences: { id: randomUUID(), effects: [] },
            },
          },
        },
      ],
      archived: false,
    },
  );
  const instance = await postJSON<ProblemInstanceResponse>(
    page,
    `${ruleSetURL}/problem-instances`,
    {
      problem_definition_id: problem.id,
      key: "conditional-instance",
      display_name: "Conditional Instance",
      bindings: [{ target_definition_id: targetId, entity_ids: [subject.id] }],
    },
  );
  const operationURL = `${ruleSetURL}/problem-instances/${instance.id}/choices/${choiceId}`;
  const preview = await postJSON<ResolutionResponse>(
    page,
    `${operationURL}/preview`,
    {
      expected_binding_revision: 0,
      expected_state_revisions: { [subject.id]: 2 },
    },
  );
  expect(preview.status).toBe("applied");
  expect(preview.preview).toBe(true);
  expect(preview.state?.records[subject.id]?.values[readiness.id]).toEqual({
    kind: "number",
    value: 3,
  });
  expect((await getJSON<StateResponse>(page, subjectStateURL)).revision).toBe(
    2,
  );

  const applied = await postJSON<ResolutionResponse>(
    page,
    `${operationURL}/resolve`,
    {
      expected_binding_revision: 0,
      expected_state_revisions: { [subject.id]: 2 },
    },
  );
  expect(applied.status).toBe("applied");
  const committed = await getJSON<StateResponse>(page, subjectStateURL);
  expect(committed.revision).toBe(3);
  expect(committed.values[readiness.id]).toEqual({
    kind: "number",
    value: 3,
  });

  const rejected = await page.request.post(`${operationURL}/resolve`, {
    data: {
      expected_binding_revision: 0,
      expected_state_revisions: { [subject.id]: 3 },
    },
  });
  expect(rejected.status()).toBe(422);
  await expect(rejected.json()).resolves.toMatchObject({
    error: { code: "effect_application_failed" },
  });
  expect(await getJSON<StateResponse>(page, subjectStateURL)).toEqual(
    committed,
  );

  const cleared = await putJSON<StateResponse>(page, subjectStateURL, {
    expected_revision: 3,
    values: {},
  });
  expect(cleared.revision).toBe(4);
  const incomplete = await postJSON<ResolutionResponse>(
    page,
    `${operationURL}/preview`,
    {},
  );
  expect(incomplete.status).toBe("incomplete");
  expect(incomplete.applied_effects).toEqual([]);
});

async function getJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  userId?: string,
): Promise<T> {
  const response = await page.request.get(url, {
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  expect(response.ok(), `${response.status()} ${url}`).toBe(true);
  return (await response.json()) as T;
}

async function postJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await page.request.post(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  expect(
    response.ok(),
    `${response.status()} ${url}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

async function putJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  data: unknown,
  userId?: string,
): Promise<T> {
  const response = await page.request.put(url, {
    data,
    ...(userId === undefined ? {} : { headers: identityHeaders(userId) }),
  });
  expect(
    response.ok(),
    `${response.status()} ${url}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}

function identityHeaders(userId: string): Record<string, string> {
  return { "X-DND-User-ID": userId };
}
