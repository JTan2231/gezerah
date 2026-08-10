import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  ApiError,
  jsonBody,
  toErrorNotice,
  worldPath,
} from "../api/client";
import type {
  AutoDMProblem,
  ConsequenceCompilation,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  StateValue,
  User,
  World,
  WorldEntity,
  WorldMechanic,
  WorldMechanicCollection,
  WorldMember,
} from "../api/types";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { useResource } from "../hooks/useResource";
import { useWorldEvents, type WorldEvent } from "../hooks/useWorldEvents";
import { EntityDetail } from "./EntityDetail";
import { EntityProfilePanel } from "./EntityProfilePanel";
import {
  CharacterOnboardingView,
  LiveInteractionView,
  WorldPlayBoundaryView,
  WorldPlayView,
} from "./WorldPlayView";
import type {
  HistoryCardViewModel,
  PlayViewIssue,
  RulingPreviewViewModel,
  SubmittedActionViewModel,
} from "./WorldPlayViewModel";
import { NewProblemView, OpenProblemView } from "./WorldProblemView";
import { RulingView } from "./WorldRulingView";

export function WorldPlay({
  world,
  user,
  onWorldChanged,
}: {
  world: World;
  user: User;
  onWorldChanged: () => void;
}) {
  const playReady = world.role !== "player" || world.play_status === "ready";
  const members = useCollection<WorldMember>(
    playReady ? worldPath(world.id, "members") : null,
  );
  const entities = useCollection<WorldEntity>(worldPath(world.id, "entities"));
  const mechanics = useResource<WorldMechanicCollection>(
    playReady ? worldPath(world.id, "mechanics") : null,
  );
  const interactions = useCollection<Interaction>(
    playReady ? worldPath(world.id, "interactions") : null,
  );
  const [creatingProblem, setCreatingProblem] = useState(false);
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState<
    string | undefined
  >();
  const reloadMembers = members.reload;
  const reloadEntities = entities.reload;
  const reloadInteractions = interactions.reload;

  const reloadMechanics = mechanics.reload;
  const refresh = useCallback(
    (event?: WorldEvent) => {
      reloadMembers();
      reloadEntities();
      reloadInteractions();
      if (event === undefined || event.type === "rules-updated") {
        reloadMechanics();
      }
      onWorldChanged();
      setProfileRefreshToken((value) => value + 1);
    },
    [
      onWorldChanged,
      reloadEntities,
      reloadInteractions,
      reloadMechanics,
      reloadMembers,
    ],
  );
  useWorldEvents(playReady ? world.id : undefined, refresh);

  useEffect(() => {
    const mechanicsRevision = mechanics.value?.revision;
    if (
      !playReady ||
      mechanicsRevision === undefined ||
      mechanics.loading ||
      entities.loading
    )
      return;
    const mismatched = entities.items.some(
      (entity) => entity.state.rules_revision !== mechanicsRevision,
    );
    if (!mismatched) return;
    reloadMechanics();
    reloadEntities();
  }, [
    entities.items,
    entities.loading,
    mechanics.loading,
    mechanics.value?.revision,
    playReady,
    reloadEntities,
    reloadMechanics,
  ]);

  useEffect(() => {
    if (playReady) return undefined;
    const timer = window.setInterval(() => {
      reloadEntities();
      onWorldChanged();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [onWorldChanged, playReady, reloadEntities]);

  if (!playReady)
    return (
      <CharacterOnboarding
        world={world}
        user={user}
        entities={entities.items}
        loading={entities.loading}
        error={entities.error}
        onRetry={entities.reload}
        refreshToken={profileRefreshToken}
        onChanged={() => {
          entities.reload();
          onWorldChanged();
        }}
      />
    );

  if (
    (members.loading && members.items.length === 0) ||
    (mechanics.loading && mechanics.value === null)
  )
    return (
      <WorldPlayBoundaryView
        model={{ kind: "loading", label: "Loading world" }}
      />
    );
  const loadIssue = toPlayViewIssue(members.error ?? mechanics.error);
  if (loadIssue !== null)
    return (
      <WorldPlayBoundaryView
        model={{ kind: "issue", issue: loadIssue }}
        onRetry={() => refresh()}
      />
    );

  const mechanicItems = mechanics.value?.mechanics ?? [];
  const rulesRevision = mechanics.value?.revision ?? world.rules_revision;
  const rulesReady =
    !mechanics.loading &&
    !entities.loading &&
    entities.error === null &&
    entities.items.every(
      (entity) => entity.state.rules_revision === rulesRevision,
    );

  const membership = members.items.find(
    (item) => item.id === world.membership_id && item.status === "active",
  );
  if (membership === undefined)
    return (
      <WorldPlayBoundaryView
        model={{
          kind: "empty",
          title: "Play access unavailable",
          description: "An active world membership is required to enter play.",
        }}
      />
    );
  const facilitator = world.role === "owner" || world.role === "editor";
  const controlledEntityIDs =
    membership.role === "player" ? membership.controlled_entity_ids : [];
  const active = interactions.items.find(
    (item) =>
      item.status === "open" ||
      item.status === "adjudicating" ||
      item.status === "draft",
  );
  const history = interactions.items.filter(
    (item) => item.status === "resolved" || item.status === "cancelled",
  );
  const firstControlledEntity = controlledEntityIDs
    .map((id) => entities.items.find((entity) => entity.id === id))
    .find((entity) => entity !== undefined && !entity.archived);
  const selectedEntity =
    entities.items.find((item) => item.id === selectedEntityId) ??
    firstControlledEntity ??
    entities.items[0];

  return (
    <WorldPlayView
      model={{
        worldName: world.name,
        currentUserName: user.display_name,
        roleLabel: facilitator ? "Facilitator" : humanize(membership.role),
        facilitator,
        canCreateProblem: facilitator && world.status === "active",
        hasActiveProblem: active !== undefined,
        roster: {
          loading: entities.loading,
          showEmpty: !entities.loading && entities.items.length === 0,
          issue: toPlayViewIssue(entities.error),
          entities: entities.items
            .filter((entity) => !entity.archived)
            .map((entity) => ({
              id: entity.id,
              name: entity.display_name,
              subtitle: entitySubtitle(
                entity,
                mechanicItems,
                members.items,
                membership.id,
              ),
              selected: selectedEntity?.id === entity.id,
              controlled: controlledEntityIDs.includes(entity.id),
              setupRequired: entity.character_status === "setup-required",
            })),
          readyMembers: members.items
            .filter(
              (item) =>
                item.status === "active" && item.play_status === "ready",
            )
            .map((item) => ({ id: item.id, name: item.display_name })),
        },
        problems: {
          loading: interactions.loading && interactions.items.length === 0,
          issue: toPlayViewIssue(interactions.error),
        },
        history: history.map((interaction) =>
          toHistoryCardViewModel(interaction, entities.items, mechanicItems),
        ),
      }}
      actions={{
        createProblem: () => setCreatingProblem(true),
        retryRoster: entities.reload,
        retryProblems: interactions.reload,
        selectEntity: setSelectedEntityId,
      }}
      slots={{
        activeProblem:
          active === undefined ? null : (
            <LiveInteraction
              interaction={active}
              world={world}
              membership={membership}
              entities={entities.items}
              mechanics={mechanicItems}
              rulesRevision={rulesRevision}
              rulesReady={rulesReady}
              facilitator={facilitator}
              onChanged={refresh}
            />
          ),
        selectedEntity:
          selectedEntity === undefined ? null : (
            <EntityDetail
              key={`${selectedEntity.id}:${selectedEntity.state.revision}:${selectedEntity.state.status_revision}:${selectedEntity.state.rules_revision}:${mechanicItems.map((mechanic) => `${mechanic.id}:${mechanic.updated_at}`).join(":")}`}
              entity={selectedEntity}
              mechanics={mechanicItems}
              rulesRevision={rulesRevision}
              mechanicsEditable={false}
              controlledByCurrentMember={controlledEntityIDs.includes(
                selectedEntity.id,
              )}
              facilitator={false}
              world={world}
              profileRefreshToken={profileRefreshToken}
              onManageControllers={() => undefined}
              onProfileChanged={refresh}
              onSaved={entities.reload}
            />
          ),
        problemDialog: creatingProblem ? (
          <NewProblemController
            world={world}
            members={members.items}
            entities={entities.items}
            onClose={() => setCreatingProblem(false)}
            onCreated={() => {
              setCreatingProblem(false);
              refresh();
            }}
          />
        ) : null,
      }}
    />
  );
}

function CharacterOnboarding({
  world,
  user,
  entities,
  loading,
  error,
  onRetry,
  refreshToken,
  onChanged,
}: {
  world: World;
  user: User;
  entities: WorldEntity[];
  loading: boolean;
  error: ApiError | null;
  onRetry: () => void;
  refreshToken: number;
  onChanged: () => void;
}) {
  const available = entities.filter(
    (entity) =>
      !entity.archived && entity.character_status !== "not-controlled",
  );
  const [selectedID, setSelectedID] = useState<string | undefined>();
  const selected =
    available.find((entity) => entity.id === selectedID) ?? available[0];

  return (
    <CharacterOnboardingView
      model={{
        worldName: world.name,
        currentUserName: user.display_name,
        statusLabel:
          world.play_status === "waiting-for-character"
            ? "Waiting for a character"
            : "Setup required",
        loading,
        issue: toPlayViewIssue(error),
        characters: available.map((entity) => ({
          id: entity.id,
          name: entity.display_name,
          completedFieldCount: entity.completed_field_count,
          requiredFieldCount: entity.required_field_count,
          selected: selected?.id === entity.id,
        })),
      }}
      actions={{ retry: onRetry, selectCharacter: setSelectedID }}
      profile={
        selected === undefined ? null : (
          <EntityProfilePanel
            world={world}
            entity={selected}
            refreshToken={refreshToken}
            onChanged={onChanged}
          />
        )
      }
    />
  );
}

function NewProblemController({
  world,
  members,
  entities,
  onClose,
  onCreated,
}: {
  world: World;
  members: WorldMember[];
  entities: WorldEntity[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const activeMembers = useMemo(
    () =>
      members.filter(
        (member) =>
          member.status === "active" && member.play_status === "ready",
      ),
    [members],
  );
  const responders = useMemo(
    () => activeMembers.filter((member) => member.role === "player"),
    [activeMembers],
  );
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [responderIds, setResponderIds] = useState(
    responders.map((member) => member.id),
  );
  const previousResponderIds = useRef(
    new Set(responders.map((member) => member.id)),
  );
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const available = new Set(responders.map((member) => member.id));
    setResponderIds((current) => [
      ...current.filter((id) => available.has(id)),
      ...responders
        .map((member) => member.id)
        .filter((id) => !previousResponderIds.current.has(id)),
    ]);
    previousResponderIds.current = available;
  }, [responders]);

  function toggle(
    values: string[],
    id: string,
    onChange: (values: string[]) => void,
  ) {
    onChange(
      values.includes(id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    );
  }

  async function generateProblem() {
    setGenerating(true);
    setError(null);
    try {
      const result = await api<AutoDMProblem>(
        worldPath(world.id, "auto-dm/problem"),
        { method: "POST" },
      );
      if (result.prompt.trim() === "")
        throw new ApiError(
          502,
          "invalid_response",
          "The Auto DM returned an empty problem.",
        );
      setPrompt(result.prompt.trim());
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not generate a problem."),
      );
    } finally {
      setGenerating(false);
    }
  }

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api<Interaction>(worldPath(world.id, "interactions"), {
        method: "POST",
        ...jsonBody({
          id: crypto.randomUUID(),
          present: true,
          title: title.trim() || undefined,
          prompt: prompt.trim(),
          audience_membership_ids: activeMembers.map((member) => member.id),
          eligible_responder_membership_ids: responderIds,
          entity_ids: entityIds,
        }),
      });
      onCreated();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this problem."),
      );
      setSaving(false);
    }
  }

  return (
    <NewProblemView
      model={{
        draft: {
          title,
          description: prompt,
          selectedEntityIds: entityIds,
          selectedResponderIds: responderIds,
        },
        contextEntities: entities
          .filter(
            (entity) =>
              !entity.archived && entity.character_status !== "setup-required",
          )
          .map((entity) => ({ id: entity.id, name: entity.display_name })),
        showContextChoices: entities.length > 0,
        responders: responders.map((member) => ({
          id: member.id,
          name: member.display_name,
        })),
        terraEnabled: world.dm_source === "terra",
        generating,
        saving,
        issue: toPlayViewIssue(error, { prompt: "description" }),
      }}
      actions={{
        changeTitle: setTitle,
        changeDescription: setPrompt,
        toggleContextEntity: (id) => toggle(entityIds, id, setEntityIds),
        toggleResponder: (id) => toggle(responderIds, id, setResponderIds),
        generate: () => void generateProblem(),
        submit: () => void submit(),
        close: onClose,
      }}
    />
  );
}

function LiveInteraction({
  interaction,
  world,
  membership,
  entities,
  mechanics,
  rulesRevision,
  rulesReady,
  facilitator,
  onChanged,
}: {
  interaction: Interaction;
  world: World;
  membership: WorldMember;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  rulesRevision: number;
  rulesReady: boolean;
  facilitator: boolean;
  onChanged: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const context = interaction.entity_ids
    .map((id) => entities.find((entity) => entity.id === id))
    .filter((item): item is WorldEntity => item !== undefined);

  async function command(action: "adjudicate" | "cancel") {
    setWorking(true);
    setError(null);
    try {
      await api<Interaction>(
        worldPath(world.id, `interactions/${interaction.id}/${action}`),
        {
          method: "POST",
          ...jsonBody({ expected_revision: interaction.revision }),
        },
      );
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(
              0,
              "unknown",
              "The problem changed before that action completed.",
            ),
      );
      setWorking(false);
    }
  }

  return (
    <LiveInteractionView
      model={{
        status: interaction.status,
        statusLabel:
          interaction.status === "open"
            ? "Accepting actions"
            : "Closed for actions",
        presentedLabel: formatRelativeDate(
          interaction.presented_at ?? interaction.created_at,
        ),
        title: interaction.title ?? "Problem",
        prompt: interaction.prompt,
        contextEntityNames: context.map((entity) => entity.display_name),
        facilitator,
        working,
        issue: toPlayViewIssue(error),
      }}
      content={
        <>
          {interaction.status === "open" ? (
            <OpenProblem
              interaction={interaction}
              world={world}
              membership={membership}
              entities={entities}
              facilitator={facilitator}
              working={working}
              onAdjudicate={() => void command("adjudicate")}
              onChanged={onChanged}
            />
          ) : null}
          {interaction.status === "adjudicating" && facilitator ? (
            <RulingEditor
              interaction={interaction}
              world={world}
              entities={entities}
              mechanics={mechanics}
              rulesRevision={rulesRevision}
              rulesReady={rulesReady}
              onResolved={onChanged}
            />
          ) : null}
        </>
      }
      onCancel={() => void command("cancel")}
    />
  );
}

function OpenProblem({
  interaction,
  world,
  membership,
  entities,
  facilitator,
  working,
  onAdjudicate,
  onChanged,
}: {
  interaction: Interaction;
  world: World;
  membership: WorldMember;
  entities: WorldEntity[];
  facilitator: boolean;
  working: boolean;
  onAdjudicate: () => void;
  onChanged: () => void;
}) {
  const eligible = interaction.eligible_responder_membership_ids.includes(
    membership.id,
  );
  const currentAction = interaction.actions.find(
    (action) =>
      action.submitted_by_membership_id === membership.id &&
      action.status === "submitted",
  );
  const [text, setText] = useState("");
  const controlledEntities = membership.controlled_entity_ids
    .map((id) => entities.find((entity) => entity.id === id))
    .filter(
      (entity): entity is WorldEntity =>
        entity !== undefined &&
        !entity.archived &&
        entity.character_status === "ready",
    );
  const [actingEntityID, setActingEntityID] = useState(
    controlledEntities.length === 1 ? (controlledEntities[0]?.id ?? "") : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        worldPath(world.id, `interactions/${interaction.id}/actions`),
        {
          method: "POST",
          ...jsonBody({
            text: text.trim(),
            acting_entity_id: actingEntityID || undefined,
            expected_revision: interaction.revision,
          }),
        },
      );
      setText("");
      onChanged();
      setSaving(false);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not submit your action."),
      );
      setSaving(false);
    }
  }

  async function withdraw() {
    if (currentAction === undefined) return;
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        worldPath(
          world.id,
          `interactions/${interaction.id}/actions/${currentAction.id}/withdraw`,
        ),
        {
          method: "POST",
          ...jsonBody({ expected_revision: currentAction.revision }),
        },
      );
      onChanged();
      setSaving(false);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not withdraw your action."),
      );
      setSaving(false);
    }
  }

  const submitted = interaction.actions.filter(
    (action) => action.status === "submitted",
  );
  return (
    <OpenProblemView
      model={{
        submissions: submitted.map(toSubmittedActionViewModel),
        facilitator,
        eligibleResponder: eligible,
        actionSubmitted: currentAction !== undefined,
        controlledEntities: controlledEntities.map((entity) => ({
          id: entity.id,
          name: entity.display_name,
        })),
        actingEntityId: actingEntityID,
        actionText: text,
        saving,
        closing: working,
        issue: toPlayViewIssue(error),
      }}
      actions={{
        changeActingEntity: setActingEntityID,
        changeActionText: setText,
        submitAction: () => void submit(),
        withdrawAction: () => void withdraw(),
        closeActions: onAdjudicate,
      }}
    />
  );
}

function RulingEditor({
  interaction,
  world,
  entities,
  mechanics,
  rulesRevision,
  rulesReady,
  onResolved,
}: {
  interaction: Interaction;
  world: World;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  rulesRevision: number;
  rulesReady: boolean;
  onResolved: () => void;
}) {
  const submitted = interaction.actions.filter(
    (action) => action.status === "submitted",
  );
  const [narrative, setNarrative] = useState("");
  const [compilation, setCompilation] = useState<{
    contextKey: string;
    result: ConsequenceCompilation;
  } | null>(null);
  const [saving, setSaving] = useState<
    "compile" | "generate" | "resolve" | null
  >(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const terra = world.dm_source === "terra";
  const contextKey = JSON.stringify({
    world_revision: world.revision,
    interaction_revision: interaction.revision,
    rules_revision: rulesRevision,
    entity_versions: entities.map((entity) => [
      entity.id,
      entity.archived,
      entity.character_status,
      entity.state.revision,
      entity.state.status_revision,
      entity.state.rules_revision,
    ]),
  });
  const compiled =
    compilation?.contextKey === contextKey &&
    compilation.result.narrative.trim() === narrative.trim()
      ? compilation.result
      : null;
  const selectedAction =
    compiled?.selected_action_id === undefined
      ? undefined
      : submitted.find((action) => action.id === compiled.selected_action_id);

  async function prepareConsequence(mode: "compile" | "generate") {
    const requestContextKey = contextKey;
    setSaving(mode);
    setError(null);
    try {
      const path =
        mode === "generate"
          ? `interactions/${interaction.id}/auto-dm/consequence`
          : `interactions/${interaction.id}/compile-consequence`;
      const result = await api<ConsequenceCompilation>(
        worldPath(world.id, path),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            expected_rules_revision: rulesRevision,
            ...(mode === "compile" ? { narrative: narrative.trim() } : {}),
          }),
        },
      );
      if (result.narrative.trim() === "")
        throw new ApiError(
          502,
          "invalid_response",
          "The consequence did not include what transpires.",
        );
      setNarrative(result.narrative.trim());
      setCompilation({ contextKey: requestContextKey, result });
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(
              0,
              "unknown",
              mode === "generate"
                ? "Could not generate a consequence."
                : "Could not interpret this consequence.",
            ),
      );
    } finally {
      setSaving(null);
    }
  }

  async function resolve() {
    if (compiled === null) return;
    setSaving("resolve");
    setError(null);
    try {
      await api<InteractionResolutionResult>(
        worldPath(world.id, `interactions/${interaction.id}/resolve`),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            expected_rules_revision: rulesRevision,
            idempotency_key: idempotencyKey,
            selected_action_id: compiled.selected_action_id,
            action_summary: compiled.action_summary,
            narrative: compiled.narrative,
            effects: compiled.effects,
          }),
        },
      );
      onResolved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not resolve this problem."),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <RulingView
      model={{
        terraEnabled: terra,
        submissions: submitted.map(toSubmittedActionViewModel),
        narrative,
        selectedAction:
          selectedAction === undefined
            ? null
            : {
                actorName:
                  selectedAction.acting_entity_name ??
                  selectedAction.submitted_by_name ??
                  "the selected action",
                text: selectedAction.text,
              },
        preview:
          compiled === null
            ? null
            : toRulingPreviewViewModel(compiled.preview, entities, mechanics),
        rulesReady,
        previewStale: compilation !== null && compiled === null,
        saving,
        issue: toPlayViewIssue(error, { narrative: "narrative" }),
      }}
      actions={{
        changeNarrative: (value) => {
          setNarrative(value);
          setCompilation(null);
          setError(null);
        },
        prepare: (mode) => void prepareConsequence(mode),
        resolve: () => void resolve(),
      }}
    />
  );
}

function toPlayViewIssue(
  error: ApiError | null,
  fieldNames: Record<string, string> = {},
): PlayViewIssue | null {
  if (error === null) return null;
  return {
    ...toErrorNotice(error),
    fields: Object.fromEntries(
      Object.entries(fieldNames).flatMap(([transportField, viewField]) => {
        const message = error.fields[transportField];
        return message === undefined ? [] : [[viewField, message]];
      }),
    ),
  };
}

function toSubmittedActionViewModel(
  action: InteractionAction,
): SubmittedActionViewModel {
  return {
    id: action.id,
    actorName:
      action.acting_entity_name ?? action.submitted_by_name ?? "Player",
    ...(action.acting_entity_name === undefined
      ? {}
      : { playerName: action.submitted_by_name ?? "Player" }),
    text: action.text,
  };
}

function toRulingPreviewViewModel(
  result: InteractionResolutionResult,
  entities: WorldEntity[],
  mechanics: WorldMechanic[],
): RulingPreviewViewModel {
  return {
    applicationSummary:
      result.applied_effects.length === 0
        ? "Narrative only"
        : `${result.applied_effects.length} state ${result.applied_effects.length === 1 ? "application" : "applications"}`,
    applications: result.applied_effects.map((effect, index) => ({
      id: `${effect.effect_id}:${effect.entity_id}:${index}`,
      entityName:
        entities.find((entity) => entity.id === effect.entity_id)
          ?.display_name ?? "Entity",
      effectLabel:
        effect.type === "apply-status"
          ? `Applied ${effect.status_name ?? "status"}`
          : effect.type === "remove-status"
            ? `Removed ${effect.status_name ?? "status"}`
            : (mechanics.find((mechanic) => mechanic.id === effect.mechanic_id)
                ?.name ?? "Mechanic"),
      outcomeLabel:
        effect.type === "apply-status" || effect.type === "remove-status"
          ? effect.changed
            ? "changed"
            : "already current"
          : `${displayValue(effect.before)} → ${displayValue(effect.after)}`,
    })),
    effectiveChanges: result.effective_changes.map((change) => ({
      id: `${change.entity_id}:${change.mechanic_id}`,
      label: `${
        entities.find((entity) => entity.id === change.entity_id)
          ?.display_name ?? "Entity"
      } · ${
        mechanics.find((mechanic) => mechanic.id === change.mechanic_id)
          ?.name ?? "Mechanic"
      }`,
      outcomeLabel: `${displayValue(change.before)} → ${displayValue(change.after)}`,
    })),
  };
}

function toHistoryCardViewModel(
  interaction: Interaction,
  entities: WorldEntity[],
  mechanics: WorldMechanic[],
): HistoryCardViewModel {
  if (interaction.status === "cancelled")
    return {
      id: interaction.id,
      outcome: "cancelled",
      occurredLabel: formatRelativeDate(interaction.cancelled_at),
      title: interaction.title ?? "Untitled problem",
      prompt: interaction.prompt,
      effects: [],
      effectiveChanges: [],
    };
  const resolution = interaction.resolution;
  return {
    id: interaction.id,
    outcome: "resolved",
    occurredLabel: formatRelativeDate(interaction.resolved_at),
    title: interaction.title ?? "Untitled problem",
    prompt: interaction.prompt,
    ...(resolution === undefined ? {} : { narrative: resolution.narrative }),
    effects:
      resolution?.applied_effects.map((effect, index) => ({
        id: `${effect.effect_id}:${effect.entity_id}:${index}`,
        label: `${
          entities.find((entity) => entity.id === effect.entity_id)
            ?.display_name ?? "Entity"
        }: ${
          effect.type === "apply-status"
            ? `applied ${effect.status_name ?? "status"}`
            : effect.type === "remove-status"
              ? `removed ${effect.status_name ?? "status"}`
              : `${
                  mechanics.find((item) => item.id === effect.mechanic_id)
                    ?.name ?? "mechanic"
                } ${displayValue(effect.before)} → ${displayValue(effect.after)}`
        }`,
      })) ?? [],
    effectiveChanges:
      resolution?.effective_changes.map((change) => ({
        id: `${change.entity_id}:${change.mechanic_id}`,
        label: `${
          entities.find((entity) => entity.id === change.entity_id)
            ?.display_name ?? "Entity"
        }: ${
          mechanics.find((mechanic) => mechanic.id === change.mechanic_id)
            ?.name ?? "mechanic"
        } ${displayValue(change.before)} → ${displayValue(change.after)}`,
      })) ?? [],
  };
}

function displayValue(value?: StateValue): string {
  if (value === undefined) return "unknown";
  return value.kind === "number" ? value.value : value.value ? "yes" : "no";
}

function entitySubtitle(
  entity: WorldEntity,
  mechanics: WorldMechanic[],
  memberships: WorldMember[],
  currentMembershipID: string,
): string {
  if (
    memberships.some(
      (membership) =>
        membership.id === currentMembershipID &&
        membership.role === "player" &&
        membership.status === "active" &&
        membership.controlled_entity_ids.includes(entity.id),
    )
  ) {
    return entity.character_status === "ready"
      ? "Your character"
      : `Your character · Setup ${entity.completed_field_count}/${entity.required_field_count}`;
  }
  const controllers = memberships.filter(
    (membership) =>
      membership.status === "active" &&
      membership.role === "player" &&
      membership.controlled_entity_ids.includes(entity.id),
  );
  if (controllers.length > 0) {
    const label =
      entity.character_status === "ready" ? "Character" : "Character setup";
    return `${label} · ${controllers.map((membership) => membership.display_name).join(", ")}`;
  }
  const capacity = mechanics.find(
    (mechanic) => mechanic.kind === "capacity" && !mechanic.archived,
  );
  if (capacity === undefined) return "Sheet ready";
  return `${capacity.name} ${displayValue(
    entity.state.effective_values[capacity.id] ??
      entity.state.values[capacity.id],
  )}`;
}
