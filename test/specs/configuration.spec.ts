import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { readBaseURL } from "../src/runtime";

interface RuleSetResponse {
  id: string;
  key: string;
  name: string;
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

test("an author configures typed state through the accessible UI", async ({
  page,
}) => {
  const baseURL = await readBaseURL();
  await page.goto(`${baseURL}/app/overview`);

  await expect(
    page.getByRole("heading", { name: "Compose a world with explicit rules." }),
  ).toBeVisible();
  const rulesetName = page.getByLabel("Ruleset name");
  await page.keyboard.press("Tab");
  await expect(rulesetName).toBeFocused();
  await rulesetName.fill("E2E Rules");
  await page.getByLabel("Stable key").fill("e2e-rules");
  await page
    .getByLabel("Description")
    .fill("Disposable browser acceptance ruleset.");
  await page.getByRole("button", { name: "Create ruleset" }).click();
  await expect(
    page.getByRole("heading", { name: "Build semantics before scenarios." }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Owner schemas" }).click();
  await page.getByRole("button", { name: /Schema$/ }).click();
  await expect(
    page.getByRole("heading", { name: "New owner schema" }),
  ).toBeVisible();
  await page.getByLabel("Label").fill("Stateful");
  await page.getByLabel("Stable key").fill("stateful");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: "Entities" }).click();
  await page.getByRole("button", { name: /Entity$/ }).click();
  await expect(page.getByRole("heading", { name: "New entity" })).toBeVisible();
  await page.getByLabel("Display name").fill("Control Panel");
  await page.getByLabel("Stable key").fill("control-panel");
  await page.getByRole("checkbox", { name: /Stateful/ }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: "State variables" }).click();
  await page.getByRole("button", { name: /Variable$/ }).click();
  await expect(
    page.getByRole("heading", { name: "New state variable" }),
  ).toBeVisible();
  await page.getByLabel("Label").fill("Powered");
  await page.getByLabel("Stable namespaced key").fill("core-powered");
  await page.getByRole("checkbox", { name: /Stateful/ }).check();
  await page
    .getByRole("group", { name: "Scalar kind" })
    .getByRole("radio", { name: /^Boolean/ })
    .check();
  await page.getByRole("checkbox", { name: "Set the complete value" }).check();
  await page
    .getByRole("checkbox", { name: "Clear to missing behavior" })
    .check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();

  await page.getByRole("button", { name: "State inspector" }).click();
  await page.getByLabel("Entity").selectOption({ label: "Control Panel" });
  await expect(
    page.getByRole("heading", { name: "Control Panel" }),
  ).toBeVisible();
  await expect(page.getByText("Unknown", { exact: true })).toBeVisible();
  await page.getByRole("radio", { name: "Override value" }).check();
  await page.getByRole("radio", { name: "True", exact: true }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("All changes saved")).toBeVisible();
  await expect(page.getByText("r1", { exact: true })).toBeVisible();

  const rulesets = await getJSON<RuleSetResponse[]>(
    page,
    `${baseURL}/api/rule-sets`,
  );
  const ruleSet = rulesets.find((item) => item.key === "e2e-rules");
  expect(ruleSet).toBeDefined();
  const entities = await getJSON<EntityResponse[]>(
    page,
    `${baseURL}/api/rule-sets/${ruleSet?.id}/entities`,
  );
  const entity = entities.find((item) => item.key === "control-panel");
  expect(entity).toBeDefined();
  const variables = await getJSON<VariableResponse[]>(
    page,
    `${baseURL}/api/rule-sets/${ruleSet?.id}/state-variable-definitions`,
  );
  const variable = variables.find((item) => item.key === "core-powered");
  expect(variable).toBeDefined();
  const state = await getJSON<{
    revision: number;
    values: Record<string, unknown>;
  }>(
    page,
    `${baseURL}/api/rule-sets/${ruleSet?.id}/entities/${entity?.id}/state`,
  );
  expect(state.revision).toBe(1);
  expect(state.values[variable?.id ?? ""]).toEqual({
    kind: "boolean",
    value: true,
  });
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

  await page.goto(`${baseURL}/app/runtime`);
  await page.getByLabel("Ruleset").selectOption({ label: ruleSet.name });
  await page
    .getByLabel("Problem instance")
    .selectOption({ label: "Training Dummy" });
  await expect(
    page.getByRole("heading", { name: "Take ten damage" }),
  ).toBeVisible();
  await expect(page.getByText("Available", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(
    page.getByText("Advisory preview", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("State changed", { exact: true })).toBeVisible();

  const stateAfterUIPreview = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
  );
  expect(stateAfterUIPreview).toEqual(initialState);

  await page.getByRole("button", { name: "Resolve choice" }).click();
  await expect(
    page.getByText("Transition applied", { exact: true }),
  ).toBeVisible();
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

  await page.getByRole("button", { name: "State inspector" }).click();
  await page.getByLabel("Entity").selectOption({ label: "Training Dummy" });
  await expect(
    page.getByText("Stored override", { exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Use default" }).check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Defaulted", { exact: true })).toBeVisible();
  const defaultedState = await getJSON<StateResponse>(
    page,
    `${ruleSetURL}/entities/${instance.id}/state`,
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
): Promise<T> {
  const response = await page.request.get(url);
  expect(response.ok(), `${response.status()} ${url}`).toBe(true);
  return (await response.json()) as T;
}

async function postJSON<T>(
  page: import("@playwright/test").Page,
  url: string,
  data: unknown,
): Promise<T> {
  const response = await page.request.post(url, { data });
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
): Promise<T> {
  const response = await page.request.put(url, { data });
  expect(
    response.ok(),
    `${response.status()} ${url}: ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as T;
}
