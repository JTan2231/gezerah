import { useMemo, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type {
  DecimalText,
  MechanicExpression,
  MechanicKind,
  World,
  WorldMechanic,
  WorldMechanicCollection,
  WorldMechanicMutation,
} from "../api/types";
import { canonicalDecimalText } from "../domain/decimal";
import { useResource } from "../hooks/useResource";
import { buildWorldURL, type Navigate } from "../worldRoutes";
import {
  MechanicEditorView,
  MechanicsView,
  type MechanicExpressionView,
  type MechanicViewIssue,
  type MechanicViewModel,
} from "./MechanicsView";

export function MechanicsWorkspace({
  world,
  kind,
  selectedId,
  navigate,
  onWorldChanged,
}: {
  world: World;
  kind: MechanicKind;
  selectedId?: string | undefined;
  navigate: Navigate;
  onWorldChanged: () => void;
}) {
  const plural = kind === "capacity" ? "capacities" : "capabilities";
  const resource = useResource<WorldMechanicCollection>(
    worldPath(world.id, "mechanics"),
  );
  const allMechanics = resource.value?.mechanics ?? [];
  const items = allMechanics.filter((item) => item.kind === kind);
  const newItem = useMemo(() => newMechanic(kind), [kind]);
  const selected =
    selectedId === "new"
      ? newItem
      : items.find((item) => item.id === selectedId);

  function select(id?: string) {
    navigate(buildWorldURL(world.id, plural, id));
  }

  return (
    <MechanicsView
      kind={kind}
      selectedId={selectedId}
      items={items.map(toMechanicView)}
      loading={resource.loading}
      issue={
        resource.error === null
          ? null
          : toMechanicIssue(resource.error, `Could not load ${plural}.`)
      }
      onRetry={resource.reload}
      onSelect={select}
      editor={
        selected === undefined ? null : (
          <MechanicEditorController
            key={selected.id}
            world={world}
            source={selected}
            allMechanics={allMechanics}
            rulesRevision={resource.value?.revision ?? world.rules_revision}
            creating={selectedId === "new"}
            onSaved={(mechanicId) => {
              resource.reload();
              onWorldChanged();
              select(mechanicId);
            }}
            onArchived={() => {
              resource.reload();
              onWorldChanged();
            }}
            onCancel={() => select()}
          />
        )
      }
    />
  );
}

function MechanicEditorController({
  world,
  source,
  allMechanics,
  rulesRevision,
  creating,
  onSaved,
  onArchived,
  onCancel,
}: {
  world: World;
  source: WorldMechanic;
  allMechanics: WorldMechanic[];
  rulesRevision: number;
  creating: boolean;
  onSaved: (mechanicId: string) => void;
  onArchived: () => void;
  onCancel: () => void;
}) {
  const sourceView = useMemo(() => toMechanicView(source), [source]);
  const mechanicsView = useMemo(
    () => allMechanics.map(toMechanicView),
    [allMechanics],
  );
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [issue, setIssue] = useState<MechanicViewIssue | null>(null);

  async function save(
    mechanic: MechanicViewModel,
  ): Promise<MechanicViewModel | undefined> {
    setSaving(true);
    setIssue(null);
    try {
      const path = creating
        ? worldPath(world.id, "mechanics")
        : worldPath(world.id, `mechanics/${mechanic.id}`);
      const saved = await api<WorldMechanicMutation>(path, {
        method: creating ? "POST" : "PUT",
        ...jsonBody(mechanicPayload(mechanic, creating, rulesRevision)),
      });
      return toMechanicView(saved.mechanic);
    } catch (reason) {
      setIssue(toMechanicIssue(reason, "Could not save this mechanic."));
      return undefined;
    } finally {
      setSaving(false);
    }
  }

  async function archive(): Promise<MechanicViewModel | undefined> {
    setArchiving(true);
    setIssue(null);
    try {
      const saved = await api<WorldMechanicMutation>(
        worldPath(world.id, `mechanics/${source.id}/archive`),
        {
          method: "POST",
          ...jsonBody({ expected_rules_revision: rulesRevision }),
        },
      );
      return toMechanicView(saved.mechanic);
    } catch (reason) {
      setIssue(toMechanicIssue(reason, "Could not archive this mechanic."));
      return undefined;
    } finally {
      setArchiving(false);
    }
  }

  return (
    <MechanicEditorView
      source={sourceView}
      allMechanics={mechanicsView}
      creating={creating}
      saving={saving}
      archiving={archiving}
      issue={issue}
      onSave={save}
      onArchive={archive}
      onSaved={onSaved}
      onArchived={onArchived}
      onCancel={onCancel}
    />
  );
}

function newMechanic(kind: MechanicKind): WorldMechanic {
  return {
    id: "new",
    kind,
    mode: kind === "capacity" ? "score" : "binary",
    source_kind: "input",
    name: "",
    description: undefined,
    step: kind === "capacity" ? "1" : undefined,
    default_number: kind === "capacity" ? "0" : undefined,
    mutable_during_play: true,
    archived: false,
    created_at: "",
    updated_at: "",
  };
}

function toMechanicView(mechanic: WorldMechanic): MechanicViewModel {
  return {
    id: mechanic.id,
    kind: mechanic.kind,
    mode: mechanic.mode,
    sourceKind: mechanic.source_kind,
    name: mechanic.name,
    description: mechanic.description,
    minimum: mechanic.minimum,
    maximum: mechanic.maximum,
    step: mechanic.step,
    defaultNumber: mechanic.default_number,
    unit: mechanic.unit,
    mutableDuringPlay: mechanic.mutable_during_play,
    expression:
      mechanic.expression === undefined
        ? undefined
        : toExpressionView(mechanic.expression),
    archived: mechanic.archived,
  };
}

function toExpressionView(
  expression: MechanicExpression,
): MechanicExpressionView {
  if (expression.operation === "mechanic-reference")
    return {
      operation: expression.operation,
      mechanicId: expression.mechanic_id,
    };
  if ("operands" in expression)
    return {
      operation: expression.operation,
      operands: expression.operands.map(toExpressionView),
    } as MechanicExpressionView;
  return expression;
}

function mechanicPayload(
  item: MechanicViewModel,
  creating: boolean,
  rulesRevision: number,
) {
  return {
    id: creating ? undefined : item.id,
    kind: item.kind,
    mode: item.mode,
    source_kind: item.sourceKind,
    name: item.name.trim(),
    description:
      item.description === undefined || item.description.trim() === ""
        ? undefined
        : item.description.trim(),
    minimum: canonicalOrOriginal(item.minimum),
    maximum: canonicalOrOriginal(item.maximum),
    step: canonicalOrOriginal(item.step),
    default_number: canonicalOrOriginal(item.defaultNumber),
    unit:
      item.unit === undefined || item.unit.trim() === ""
        ? undefined
        : item.unit.trim(),
    mutable_during_play: item.mutableDuringPlay,
    expression:
      item.sourceKind === "derived"
        ? toApiExpression(item.expression)
        : undefined,
    archived: item.archived,
    expected_rules_revision: rulesRevision,
  };
}

function toApiExpression(
  expression: MechanicExpressionView | undefined,
): MechanicExpression | undefined {
  if (expression === undefined) return undefined;
  if (expression.operation === "mechanic-reference")
    return {
      operation: expression.operation,
      mechanic_id: expression.mechanicId,
    };
  if (expression.operation === "literal")
    return expression.value.kind === "number"
      ? {
          operation: expression.operation,
          value: {
            kind: "number",
            value:
              canonicalDecimalText(expression.value.value) ??
              expression.value.value,
          },
        }
      : expression;
  return {
    operation: expression.operation,
    operands: expression.operands.map(
      (operand) => toApiExpression(operand) ?? operand,
    ),
  } as MechanicExpression;
}

function canonicalOrOriginal(
  value: DecimalText | undefined,
): DecimalText | undefined {
  if (value === undefined) return undefined;
  return canonicalDecimalText(value) ?? value;
}

function toMechanicIssue(
  reason: unknown,
  fallbackMessage: string,
): MechanicViewIssue {
  if (!(reason instanceof ApiError))
    return {
      kind: "request",
      message: fallbackMessage,
      fields: {},
    };
  return {
    ...toErrorNotice(reason),
    fields: {
      name: reason.fields["name"],
      defaultNumber: reason.fields["default_number"],
      minimum: reason.fields["minimum"],
      maximum: reason.fields["maximum"],
      expression: Object.entries(reason.fields).find(([path]) =>
        path.includes("expression"),
      )?.[1],
    },
  };
}
