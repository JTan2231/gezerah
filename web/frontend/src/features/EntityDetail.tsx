import { useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type {
  ActiveStatus,
  DecimalText,
  StateValue,
  World,
  WorldEntity,
  WorldMechanic,
} from "../api/types";
import { canonicalDecimalText } from "../domain/decimal";
import { formatRelativeDate } from "../domain/display";
import { confirmDiscardDraft, useDirtyGuard } from "../hooks/useDraft";
import {
  EntityDetailView,
  EntitySheetView,
  type EntitySheetIssue,
} from "./EntityDetailView";
import { EntityProfilePanel } from "./EntityProfilePanel";

export function EntityDetail({
  entity,
  mechanics,
  rulesRevision,
  mechanicsEditable,
  controlledByCurrentMember,
  facilitator,
  world,
  profileRefreshToken,
  onManageControllers,
  onProfileChanged,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  rulesRevision: number;
  mechanicsEditable: boolean;
  controlledByCurrentMember: boolean;
  facilitator: boolean;
  world: World;
  profileRefreshToken: number;
  onManageControllers: () => void;
  onProfileChanged: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<"story" | "sheet">(
    controlledByCurrentMember && !facilitator ? "story" : "sheet",
  );

  function selectTab(nextTab: "story" | "sheet") {
    if (nextTab === tab || !confirmDiscardDraft()) return;
    setTab(nextTab);
  }

  return (
    <EntityDetailView
      tab={tab}
      showControllers={facilitator && world.status === "active"}
      onSelectTab={selectTab}
      onManageControllers={onManageControllers}
      characterPanel={
        <EntityProfilePanel
          world={world}
          entity={entity}
          refreshToken={profileRefreshToken}
          onChanged={onProfileChanged}
          editable={controlledByCurrentMember || facilitator}
        />
      }
      sheetPanel={
        <EntitySheetController
          entity={entity}
          mechanics={mechanics}
          rulesRevision={rulesRevision}
          editable={mechanicsEditable}
          world={world}
          onSaved={onSaved}
        />
      }
    />
  );
}

function EntitySheetController({
  entity,
  mechanics,
  rulesRevision,
  editable,
  world,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  rulesRevision: number;
  editable: boolean;
  world: World;
  onSaved: () => void;
}) {
  const activeMechanics = mechanics.filter((mechanic) => !mechanic.archived);
  const inputMechanics = mechanics.filter(
    (mechanic) => mechanic.source_kind === "input",
  );
  const initial = useMemo(
    () =>
      Object.fromEntries(
        activeMechanics
          .filter((mechanic) => mechanic.source_kind === "input")
          .map((mechanic) => [
            mechanic.id,
            mechanicValue(entity.state.values[mechanic.id], mechanic),
          ]),
      ),
    [activeMechanics, entity],
  );
  const [values, setValues] =
    useState<Record<string, DecimalText | boolean>>(initial);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<EntitySheetIssue | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function save() {
    setSaving(true);
    setIssue(null);
    const stateValues: Record<string, StateValue> = {};
    for (const mechanic of inputMechanics) {
      const current = entity.state.values[mechanic.id];
      if (current !== undefined) stateValues[mechanic.id] = current;
    }
    for (const mechanic of activeMechanics.filter(
      (candidate) => candidate.source_kind === "input",
    )) {
      const value = values[mechanic.id];
      if (mechanic.mode === "binary") {
        stateValues[mechanic.id] = {
          kind: "boolean",
          value: Boolean(value),
        };
        continue;
      }
      const decimal =
        typeof value === "string" ? canonicalDecimalText(value) : undefined;
      if (decimal === undefined) {
        setSaving(false);
        setIssue({
          kind: "request",
          message: `${mechanic.name} must be a finite decimal.`,
        });
        return;
      }
      stateValues[mechanic.id] = { kind: "number", value: decimal };
    }
    try {
      await api(worldPath(world.id, `entities/${entity.id}/state`), {
        method: "PUT",
        ...jsonBody({
          expected_revision: entity.state.revision,
          expected_rules_revision: rulesRevision,
          values: stateValues,
        }),
      });
      clearDirtyGuard();
      onSaved();
    } catch (reason) {
      setIssue(toEntitySheetIssue(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <EntitySheetView
      displayName={entity.display_name}
      metadata={`Entity sheet · state r${entity.state.revision} · statuses r${entity.state.status_revision} · rules r${rulesRevision}`}
      statuses={entity.state.active_statuses.map((status) => ({
        id: status.id,
        name: status.name,
        details: activeStatusDetails(status),
      }))}
      mechanics={activeMechanics.map((mechanic) => {
        const effective =
          entity.state.effective_values[mechanic.id] ??
          entity.state.evaluations[mechanic.id]?.effective ??
          entity.state.values[mechanic.id];
        return {
          id: mechanic.id,
          kind: mechanic.kind,
          mode: mechanic.mode,
          sourceKind: mechanic.source_kind,
          name: mechanic.name,
          description: mechanic.description,
          maximum: mechanic.maximum,
          unit: mechanic.unit,
          effectiveValue: formatMechanicValue(effective, mechanic),
          modifiers:
            entity.state.evaluations[mechanic.id]?.modifiers.map(
              (modifier) => ({
                id: `${modifier.status_instance_id}:${modifier.modifier_id}`,
                statusName: modifier.status_name,
                summary: `${modifierOperationLabel(modifier.operation)} ${formatStateValue(modifier.operand)} · ${formatStateValue(modifier.before)} → ${formatStateValue(modifier.after)}`,
              }),
            ) ?? [],
        };
      })}
      editable={editable}
      values={values}
      saving={saving}
      issue={issue}
      onValueChange={(mechanicId, value) =>
        setValues((current) => ({ ...current, [mechanicId]: value }))
      }
      onSubmit={() => void save()}
    />
  );
}

function mechanicValue(
  value: StateValue | undefined,
  mechanic: WorldMechanic,
): DecimalText | boolean {
  if (value === undefined)
    return mechanic.mode === "binary"
      ? false
      : (mechanic.default_number ?? "0");
  if (value.kind === "boolean") return value.value;
  if (value.kind === "number") return value.value;
  return mechanic.mode === "binary" ? false : (mechanic.default_number ?? "0");
}

function formatMechanicValue(
  value: StateValue | undefined,
  mechanic: WorldMechanic,
): string {
  const rendered = formatStateValue(value);
  if (value?.kind !== "number") return rendered;
  if (mechanic.mode === "pool" && mechanic.maximum !== undefined)
    return `${rendered} / ${mechanic.maximum}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
  return `${rendered}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
}

function formatStateValue(value: StateValue | undefined): string {
  if (value === undefined) return "Unavailable";
  return value.kind === "number" ? value.value : value.value ? "Yes" : "No";
}

function modifierOperationLabel(operation: string): string {
  switch (operation) {
    case "add-number":
      return "add";
    case "multiply-number":
      return "multiply by";
    default:
      return "set to";
  }
}

function toEntitySheetIssue(reason: unknown): EntitySheetIssue {
  if (!(reason instanceof ApiError))
    return { kind: "request", message: "Could not save this sheet." };
  return toErrorNotice(reason);
}

function activeStatusDetails(status: ActiveStatus): string {
  const description =
    status.description === undefined ? "" : `${status.description} · `;
  return `${description}Problem ${shortID(status.source_interaction_id)} · applied ${formatRelativeDate(status.applied_at)} · instance ${shortID(status.id)}`;
}

function shortID(id: string): string {
  return id.slice(0, 8);
}
