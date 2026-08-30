import { useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type {
  StatusInstance,
  DecimalText,
  MechanicValue,
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
  const [tab, setTab] = useState<"profile" | "sheet">(
    controlledByCurrentMember && !facilitator ? "profile" : "sheet",
  );

  function selectTab(nextTab: "profile" | "sheet") {
    if (nextTab === tab || !confirmDiscardDraft()) return;
    setTab(nextTab);
  }

  return (
    <EntityDetailView
      tab={tab}
      showControllers={facilitator && world.status === "active"}
      onSelectTab={selectTab}
      onManageControllers={onManageControllers}
      profilePanel={
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
  const initialLogicalInputValues = useMemo(
    () =>
      Object.fromEntries(
        activeMechanics
          .filter((mechanic) => mechanic.source_kind === "input")
          .map((mechanic) => [
            mechanic.id,
            logicalInputEditorValue(
              entity.sheet.logical_input_values[mechanic.id],
              mechanic,
            ),
          ]),
      ),
    [activeMechanics, entity],
  );
  const [logicalInputValues, setLogicalInputValues] = useState<
    Record<string, DecimalText | boolean>
  >(initialLogicalInputValues);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState<EntitySheetIssue | null>(null);
  const dirty =
    JSON.stringify(logicalInputValues) !==
    JSON.stringify(initialLogicalInputValues);
  const clearDirtyGuard = useDirtyGuard(dirty);

  async function saveLogicalState() {
    setSaving(true);
    setIssue(null);
    const nextLogicalInputValues: Record<string, MechanicValue> = {};
    for (const mechanic of inputMechanics) {
      const current = entity.sheet.logical_input_values[mechanic.id];
      if (current !== undefined) nextLogicalInputValues[mechanic.id] = current;
    }
    for (const mechanic of activeMechanics.filter(
      (candidate) => candidate.source_kind === "input",
    )) {
      const value = logicalInputValues[mechanic.id];
      if (mechanic.mode === "binary") {
        nextLogicalInputValues[mechanic.id] = {
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
      nextLogicalInputValues[mechanic.id] = {
        kind: "number",
        value: decimal,
      };
    }
    try {
      await api(worldPath(world.id, `entities/${entity.id}/logical-state`), {
        method: "PUT",
        ...jsonBody({
          expected_logical_state_revision: entity.sheet.logical_state_revision,
          expected_rules_revision: rulesRevision,
          logical_input_values: nextLogicalInputValues,
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
      metadata={`Entity sheet · logical state r${entity.sheet.logical_state_revision} · status set r${entity.sheet.status_set_revision} · rules revision r${rulesRevision}`}
      statusInstances={entity.sheet.active_status_instances.map((status) => ({
        id: status.id,
        name: status.name,
        details: statusInstanceDetails(status),
      }))}
      mechanics={activeMechanics.map((mechanic) => {
        const effective =
          entity.sheet.effective_values[mechanic.id] ??
          entity.sheet.evaluations[mechanic.id]?.effective ??
          entity.sheet.logical_input_values[mechanic.id];
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
            entity.sheet.evaluations[mechanic.id]?.modifiers.map(
              (modifier) => ({
                id: `${modifier.status_instance_id}:${modifier.modifier_id}`,
                statusName: modifier.status_name,
                summary: `${modifierOperationLabel(modifier.operation)} ${formatTypedValue(modifier.operand)} · ${formatTypedValue(modifier.before)} → ${formatTypedValue(modifier.after)}`,
              }),
            ) ?? [],
        };
      })}
      editable={editable}
      logicalInputValues={logicalInputValues}
      saving={saving}
      issue={issue}
      onValueChange={(mechanicId, value) =>
        setLogicalInputValues((current) => ({
          ...current,
          [mechanicId]: value,
        }))
      }
      onSubmit={() => void saveLogicalState()}
    />
  );
}

function logicalInputEditorValue(
  value: MechanicValue | undefined,
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
  value: MechanicValue | undefined,
  mechanic: WorldMechanic,
): string {
  const rendered = formatTypedValue(value);
  if (value?.kind !== "number") return rendered;
  if (mechanic.mode === "pool" && mechanic.maximum !== undefined)
    return `${rendered} / ${mechanic.maximum}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
  return `${rendered}${mechanic.unit === undefined ? "" : ` ${mechanic.unit}`}`;
}

function formatTypedValue(value: MechanicValue | undefined): string {
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
    return { kind: "request", message: "Could not save logical state." };
  return toErrorNotice(reason);
}

function statusInstanceDetails(status: StatusInstance): string {
  const description =
    status.description === undefined ? "" : `${status.description} · `;
  return `${description}Problem ${shortID(status.source_interaction_id)} · resolved ${formatRelativeDate(status.resolved_at)} · instance ${shortID(status.id)}`;
}

function shortID(id: string): string {
  return id.slice(0, 8);
}
