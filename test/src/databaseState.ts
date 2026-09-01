import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { artifactsDir, runtimePath } from "./paths";

const execFileAsync = promisify(execFile);
const canonicalUUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type DatabaseScalar = string | number | boolean | null;
export type DatabaseRow = Readonly<Record<string, DatabaseScalar>>;

interface TableProjection {
  readonly name: string;
  readonly columns: readonly string[];
  readonly predicate: (worldID: string) => string;
  readonly orderBy: string;
}

function worldIDPredicate(worldID: string): string {
  return `world_id = '${worldID}'::uuid`;
}

const WORLD_DATABASE_TABLES = [
  {
    name: "worlds",
    columns: [
      "id",
      "name",
      "status",
      "revision::text as revision",
      "roster_revision::text as roster_revision",
      "facilitator_source",
      "facilitator_membership_id",
      "created_at",
      "updated_at",
    ],
    predicate: (worldID: string) => `id = '${worldID}'::uuid`,
    orderBy: "id",
  },
  {
    name: "world_memberships",
    columns: [
      "id",
      "world_id",
      "role",
      "status",
      "revision::text as revision",
      "joined_at",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "created_at, id",
  },
  {
    name: "world_mechanic_graphs",
    columns: [
      "world_id",
      "revision::text as revision",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "world_id",
  },
  {
    name: "world_mechanics",
    columns: [
      "id",
      "world_id",
      "kind",
      "mode",
      "value_kind",
      "source_kind",
      "name",
      "description",
      "minimum::text as minimum",
      "maximum::text as maximum",
      "step::text as step",
      "default_number::text as default_number",
      "unit",
      "mutable_during_play",
      "position",
      "archived",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "kind, position, id",
  },
  {
    name: "world_mechanic_expression_nodes",
    columns: [
      "id",
      "world_id",
      "mechanic_id",
      "mechanic_value_kind",
      "mechanic_source_kind",
      "parent_node_id",
      "position",
      "operation",
      "value_kind",
      "number_value::text as number_value",
      "boolean_value",
      "referenced_mechanic_id",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "mechanic_id, parent_node_id nulls first, position, id",
  },
  {
    name: "entities",
    columns: [
      "id",
      "world_id",
      "display_name",
      "archived",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "created_at, id",
  },
  {
    name: "entity_logical_states",
    columns: [
      "entity_id",
      "world_id",
      "revision::text as revision",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "entity_id",
  },
  {
    name: "entity_input_value_overrides",
    columns: [
      "entity_id",
      "world_id",
      "mechanic_id",
      "mechanic_source_kind",
      "value_kind",
      "number_value::text as number_value",
      "boolean_value",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "entity_id, mechanic_id",
  },
  {
    name: "entity_status_sets",
    columns: [
      "entity_id",
      "world_id",
      "revision::text as revision",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "entity_id",
  },
  {
    name: "world_membership_entity_controls",
    columns: ["world_id", "membership_id", "entity_id", "created_at"],
    predicate: worldIDPredicate,
    orderBy: "membership_id, entity_id",
  },
  {
    name: "interactions",
    columns: [
      "id",
      "world_id",
      "title",
      "prompt",
      "status",
      "revision::text as revision",
      "created_by_membership_id",
      "presented_at",
      "resolved_at",
      "cancelled_at",
      "created_at",
      "updated_at",
      "facilitator_source",
    ],
    predicate: worldIDPredicate,
    orderBy: "created_at, id",
  },
  {
    name: "interaction_audience_members",
    columns: ["interaction_id", "world_id", "membership_id"],
    predicate: worldIDPredicate,
    orderBy: "interaction_id, membership_id",
  },
  {
    name: "interaction_eligible_responders",
    columns: ["interaction_id", "world_id", "membership_id"],
    predicate: worldIDPredicate,
    orderBy: "interaction_id, membership_id",
  },
  {
    name: "interaction_context_entities",
    columns: [
      "interaction_id",
      "world_id",
      "entity_id",
      "visibility",
      "position",
    ],
    predicate: worldIDPredicate,
    orderBy: "interaction_id, position, entity_id",
  },
  {
    name: "interaction_actions",
    columns: [
      "id",
      "interaction_id",
      "world_id",
      "submitted_by_membership_id",
      "acting_entity_id",
      "acting_entity_name",
      "text",
      "status",
      "revision::text as revision",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "created_at, id",
  },
  {
    name: "interaction_resolutions",
    columns: [
      "id",
      "interaction_id",
      "world_id",
      "selected_action_id",
      "action_summary",
      "public_narrative",
      "status",
      "created_by_membership_id",
      "resolved_by_membership_id",
      "resolved_at",
      "created_at",
      "updated_at",
      "rules_revision::text as rules_revision",
      "facilitator_source",
    ],
    predicate: worldIDPredicate,
    orderBy: "created_at, id",
  },
  {
    name: "interaction_resolution_effects",
    columns: [
      "id",
      "resolution_id",
      "world_id",
      "position",
      "operation",
      "mechanic_id",
      "value_kind",
      "set_number::text as set_number",
      "set_boolean",
      "adjustment_amount::text as adjustment_amount",
      "status_name",
      "status_description",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, position, id",
  },
  {
    name: "interaction_resolution_inline_status_modifiers",
    columns: [
      "id",
      "effect_id",
      "resolution_id",
      "world_id",
      "effect_operation",
      "position",
      "priority",
      "operation",
      "mechanic_id",
      "value_kind",
      "number_value::text as number_value",
      "boolean_value",
      "created_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, effect_id, position, id",
  },
  {
    name: "interaction_resolution_effect_targets",
    columns: [
      "effect_id",
      "resolution_id",
      "world_id",
      "entity_id",
      "position",
      "effect_operation",
      "status_instance_id",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, effect_id, position, entity_id",
  },
  {
    name: "entity_status_instances",
    columns: [
      "id",
      "world_id",
      "entity_id",
      "source_resolution_id",
      "source_effect_id",
      "source_effect_operation",
      "status_name",
      "status_description",
      "status",
      "applied_order::text as applied_order",
      "applied_at",
      "removed_at",
      "created_at",
      "updated_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "applied_order::bigint, id",
  },
  {
    name: "entity_status_instance_modifiers",
    columns: [
      "id",
      "status_instance_id",
      "world_id",
      "entity_id",
      "source_resolution_id",
      "source_effect_id",
      "source_modifier_id",
      "position",
      "priority",
      "operation",
      "mechanic_id",
      "value_kind",
      "number_value::text as number_value",
      "boolean_value",
      "created_at",
    ],
    predicate: worldIDPredicate,
    orderBy: "status_instance_id, position, id",
  },
  {
    name: "interaction_resolution_scalar_applications",
    columns: [
      "id",
      "resolution_id",
      "effect_id",
      "world_id",
      "mechanic_id",
      "value_kind",
      "entity_id",
      "position",
      "changed",
      "before_number::text as before_number",
      "before_boolean",
      "after_number::text as after_number",
      "after_boolean",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, position, id",
  },
  {
    name: "interaction_resolution_status_applications",
    columns: [
      "id",
      "resolution_id",
      "effect_id",
      "world_id",
      "entity_id",
      "status_name",
      "status_instance_id",
      "target_status_instance_id",
      "position",
      "operation",
      "changed",
      "before_active",
      "after_active",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, position, id",
  },
  {
    name: "interaction_resolution_effective_changes",
    columns: [
      "id",
      "resolution_id",
      "world_id",
      "entity_id",
      "mechanic_id",
      "value_kind",
      "position",
      "before_number::text as before_number",
      "before_boolean",
      "after_number::text as after_number",
      "after_boolean",
    ],
    predicate: worldIDPredicate,
    orderBy: "resolution_id, position, id",
  },
  {
    name: "world_events",
    columns: [
      "id::text as id",
      "world_id",
      "event_type",
      "actor_membership_id",
      "interaction_id",
      "action_id",
      "resolution_id",
      "created_at",
      "invalidates_interaction_audience",
      "actor_source",
    ],
    predicate: worldIDPredicate,
    orderBy: "id::bigint",
  },
] as const satisfies readonly TableProjection[];

export type WorldDatabaseTableName =
  (typeof WORLD_DATABASE_TABLES)[number]["name"];

export type WorldDatabaseState = Readonly<
  Record<WorldDatabaseTableName, readonly DatabaseRow[]>
>;

export interface WorldDatabaseTraceStep {
  readonly sequence: number;
  readonly operation: string;
  readonly references: Readonly<Record<string, string>>;
  readonly changed_tables: readonly WorldDatabaseTableName[];
  readonly state: WorldDatabaseState;
}

export interface WorldDatabaseTraceDocument {
  readonly schema_version: 1;
  readonly world_id: string;
  readonly scope: "world-scoped agent-facilitator command persistence tables";
  readonly excluded: readonly string[];
  readonly steps: readonly WorldDatabaseTraceStep[];
}

export const agentFacilitatorCommandDatabaseTracePath = path.join(
  artifactsDir,
  "agent-facilitator-command-database-trace.json",
);

export class WorldDatabaseTrace {
  readonly #steps: WorldDatabaseTraceStep[] = [];

  constructor(readonly worldID: string) {
    assertCanonicalUUID(worldID, "database-trace World ID");
  }

  async capture(
    operation: string,
    references: Readonly<Record<string, string>> = {},
  ): Promise<WorldDatabaseTraceStep> {
    if (operation.trim() === "") {
      throw new Error("database-trace operation must not be empty");
    }
    for (const [name, value] of Object.entries(references)) {
      if (name.trim() === "" || value.trim() === "") {
        throw new Error("database-trace references must not be empty");
      }
    }
    const state = await readWorldDatabaseState(this.worldID);
    const previous = this.#steps.at(-1)?.state;
    const changedTables = Object.freeze(
      previous === undefined
        ? []
        : WORLD_DATABASE_TABLES.map(({ name }) => name).filter(
            (name) =>
              JSON.stringify(previous[name]) !== JSON.stringify(state[name]),
          ),
    );
    const step = Object.freeze({
      sequence: this.#steps.length,
      operation,
      references: Object.freeze({ ...references }),
      changed_tables: changedTables,
      state,
    });
    this.#steps.push(step);
    await this.#write();
    return step;
  }

  document(): WorldDatabaseTraceDocument {
    return Object.freeze({
      schema_version: 1 as const,
      world_id: this.worldID,
      scope:
        "world-scoped agent-facilitator command persistence tables" as const,
      excluded: Object.freeze([
        "users and auth_sessions",
        "World invite tokens and redemptions",
        "Character fields and Entity-profile prose",
        "Interaction and Resolution private_notes",
        "Resolution idempotency_key",
      ]),
      steps: Object.freeze([...this.#steps]),
    });
  }

  async #write(): Promise<void> {
    await mkdir(artifactsDir, { recursive: true });
    await writeFile(
      agentFacilitatorCommandDatabaseTracePath,
      `${JSON.stringify(this.document(), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(agentFacilitatorCommandDatabaseTracePath, 0o600);
  }
}

export async function readWorldDatabaseState(
  worldID: string,
): Promise<WorldDatabaseState> {
  assertCanonicalUUID(worldID, "database-state World ID");
  const { stdout } = await execFileAsync(
    "psql",
    [
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      buildWorldDatabaseStateSQL(worldID),
    ],
    {
      env: await readDatabaseEnvironment(),
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const raw = stdout.trim();
  if (raw === "") {
    throw new Error("database-state query returned no JSON");
  }
  return validateWorldDatabaseState(JSON.parse(raw) as unknown);
}

export function buildWorldDatabaseStateSQL(worldID: string): string {
  assertCanonicalUUID(worldID, "database-state World ID");
  const entries = WORLD_DATABASE_TABLES.map(
    ({ name, columns, predicate, orderBy }) => `'${name}', (
      select coalesce(json_agg(row_to_json(database_state_row)), '[]'::json)
      from (
        select ${columns.join(", ")}
        from ${name}
        where ${predicate(worldID)}
        order by ${orderBy}
      ) database_state_row
    )`,
  );
  return `begin isolation level repeatable read read only;
set local timezone = 'UTC';
select json_build_object(
  ${entries.join(",\n  ")}
)::text;
commit;`;
}

function validateWorldDatabaseState(value: unknown): WorldDatabaseState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("database-state query returned an invalid root");
  }
  const record = value as Record<string, unknown>;
  const expectedNames = WORLD_DATABASE_TABLES.map(({ name }) => name);
  const actualNames = Object.keys(record);
  if (
    actualNames.length !== expectedNames.length ||
    actualNames.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error("database-state query returned unexpected tables");
  }
  for (const name of expectedNames) {
    const rows = record[name];
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) => typeof row !== "object" || row === null || Array.isArray(row),
      )
    ) {
      throw new Error(`database-state query returned invalid ${name} rows`);
    }
  }
  return value as WorldDatabaseState;
}

async function readDatabaseEnvironment(): Promise<NodeJS.ProcessEnv> {
  const source = await readFile(runtimePath, "utf8");
  const value: unknown = JSON.parse(source);
  if (
    typeof value !== "object" ||
    value === null ||
    !("controlledTimeDatabaseURL" in value) ||
    typeof value.controlledTimeDatabaseURL !== "string"
  ) {
    throw new Error("invalid database-state E2E runtime metadata");
  }
  let databaseURL: URL;
  try {
    databaseURL = new URL(value.controlledTimeDatabaseURL);
  } catch {
    throw new Error("invalid database-state E2E database URL");
  }
  if (
    (databaseURL.protocol !== "postgres:" &&
      databaseURL.protocol !== "postgresql:") ||
    databaseURL.hostname === "" ||
    databaseURL.pathname.length <= 1
  ) {
    throw new Error("invalid database-state E2E database URL");
  }
  for (const key of databaseURL.searchParams.keys()) {
    if (key !== "sslmode") {
      throw new Error("invalid database-state E2E database URL options");
    }
  }
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: databaseURL.hostname,
    PGPORT: databaseURL.port || "5432",
    PGDATABASE: decodeURIComponent(databaseURL.pathname.slice(1)),
    PGAPPNAME: "gezerah-e2e-database-state",
  };
  if (databaseURL.username !== "") {
    environment.PGUSER = decodeURIComponent(databaseURL.username);
  }
  if (databaseURL.password !== "") {
    environment.PGPASSWORD = decodeURIComponent(databaseURL.password);
  }
  const sslMode = databaseURL.searchParams.get("sslmode");
  if (sslMode !== null) environment.PGSSLMODE = sslMode;
  return environment;
}

function assertCanonicalUUID(value: string, label: string): void {
  if (!canonicalUUID.test(value)) {
    throw new Error(`${label} must be a canonical UUID`);
  }
}
