import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
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
import {
  Avatar,
  EmptyState,
  ErrorMessage,
  Field,
  LoadingState,
  Modal,
} from "../components/StudioUI";
import { formatRelativeDate, humanize } from "../domain/display";
import { useCollection } from "../hooks/useCollection";
import { useResource } from "../hooks/useResource";
import { useWorldEvents, type WorldEvent } from "../hooks/useWorldEvents";
import { EntityProfilePanel } from "./EntityProfilePanel";
import { EntityDetail } from "./EntityDetail";

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
    return <LoadingState label="Loading world" />;
  if (members.error !== null || mechanics.error !== null)
    return (
      <ErrorMessage
        error={(members.error ?? mechanics.error) as ApiError}
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
      <EmptyState
        title="Play access unavailable"
        description="An active world membership is required to enter play."
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
    <section className="play-page">
      <header className="play-header">
        <div>
          <h1>{world.name}</h1>
        </div>
        <div className="play-header-actions">
          <div className="table-role">
            <Avatar name={user.display_name} size="small" />
            <span>
              <small>Role</small>
              <strong>
                {facilitator ? "Facilitator" : humanize(membership.role)}
              </strong>
            </span>
          </div>
          {facilitator && world.status === "active" ? (
            <button
              className="button button-play"
              type="button"
              onClick={() => setCreatingProblem(true)}
              disabled={active !== undefined}
            >
              New problem
            </button>
          ) : null}
        </div>
      </header>

      <div className="play-grid">
        <aside className="roster-panel">
          <header>
            <h2>Entities</h2>
          </header>
          {entities.loading && entities.items.length === 0 ? (
            <LoadingState label="Loading roster" />
          ) : null}
          {entities.error === null ? null : (
            <ErrorMessage error={entities.error} onRetry={entities.reload} />
          )}
          <div className="roster-list">
            {entities.items
              .filter((entity) => !entity.archived)
              .map((entity) => (
                <button
                  className={[
                    "roster-item",
                    selectedEntity?.id === entity.id ? "active" : "",
                    controlledEntityIDs.includes(entity.id)
                      ? "roster-item-character"
                      : "",
                    entity.character_status === "setup-required"
                      ? "roster-item-setup"
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  type="button"
                  key={entity.id}
                  onClick={() => setSelectedEntityId(entity.id)}
                >
                  <span className="entity-token" aria-hidden="true">
                    {entity.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{entity.display_name}</strong>
                    <small>
                      {entitySubtitle(
                        entity,
                        mechanicItems,
                        members.items,
                        membership.id,
                      )}
                    </small>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
              ))}
          </div>
          {!entities.loading && entities.items.length === 0 ? (
            <div className="roster-empty">
              <strong>No entities</strong>
              <p>Create entities and generated sheets in Build.</p>
            </div>
          ) : null}
          <div className="table-members">
            <p>
              {
                members.items.filter(
                  (item) =>
                    item.status === "active" && item.play_status === "ready",
                ).length
              }{" "}
              active members
            </p>
            <div>
              {members.items
                .filter(
                  (item) =>
                    item.status === "active" && item.play_status === "ready",
                )
                .slice(0, 6)
                .map((item) => (
                  <Avatar key={item.id} name={item.display_name} size="small" />
                ))}
            </div>
          </div>
        </aside>

        <main className="table-stage">
          {interactions.loading && interactions.items.length === 0 ? (
            <LoadingState label="Loading problems" />
          ) : null}
          {interactions.error === null ? null : (
            <ErrorMessage
              error={interactions.error}
              onRetry={interactions.reload}
            />
          )}
          {active === undefined ? (
            <IdleTable
              facilitator={facilitator}
              canCreate={facilitator && world.status === "active"}
              onCreate={() => setCreatingProblem(true)}
            />
          ) : (
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
          )}

          {history.length > 0 ? (
            <section className="history-feed">
              <header>
                <h2>History</h2>
              </header>
              {history.map((interaction) => (
                <HistoryCard
                  key={interaction.id}
                  interaction={interaction}
                  entities={entities.items}
                  mechanics={mechanicItems}
                />
              ))}
            </section>
          ) : null}
        </main>

        <aside className="entity-sheet-panel">
          {selectedEntity === undefined ? (
            <EmptyState
              title="No entity selected"
              description="Select an entity to view its profile and generated sheet."
            />
          ) : (
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
          )}
        </aside>
      </div>

      {creatingProblem ? (
        <NewProblemModal
          world={world}
          members={members.items}
          entities={entities.items}
          onClose={() => setCreatingProblem(false)}
          onCreated={() => {
            setCreatingProblem(false);
            refresh();
          }}
        />
      ) : null}
    </section>
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
    <section className="character-onboarding-page">
      <header className="play-header onboarding-header">
        <div>
          <h1>{world.name}</h1>
          <p>
            {user.display_name}, complete all required fields for a controlled
            character before entering Play.
          </p>
        </div>
        <span className="character-status status-setup">
          {world.play_status === "waiting-for-character"
            ? "Waiting for a character"
            : "Setup required"}
        </span>
      </header>

      {loading && available.length === 0 ? (
        <LoadingState label="Loading characters" />
      ) : null}
      {error === null ? null : <ErrorMessage error={error} onRetry={onRetry} />}
      {!loading && available.length === 0 ? (
        <div className="onboarding-waiting panel">
          <EmptyState
            title="No character assigned"
            description="An owner or editor must create an entity and assign you as a controller."
          />
        </div>
      ) : null}

      {selected === undefined ? null : (
        <div className="onboarding-layout">
          {available.length > 1 ? (
            <aside className="panel onboarding-characters">
              <h2>Your characters</h2>
              {available.map((entity) => (
                <button
                  className={entity.id === selected.id ? "active" : ""}
                  type="button"
                  key={entity.id}
                  onClick={() => setSelectedID(entity.id)}
                >
                  <span className="entity-token" aria-hidden="true">
                    {entity.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{entity.display_name}</strong>
                    <small>
                      {entity.completed_field_count} of{" "}
                      {entity.required_field_count} complete
                    </small>
                  </span>
                </button>
              ))}
            </aside>
          ) : null}
          <div className="panel onboarding-profile">
            <EntityProfilePanel
              world={world}
              entity={selected}
              refreshToken={refreshToken}
              onChanged={onChanged}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function IdleTable({
  facilitator,
  canCreate,
  onCreate,
}: {
  facilitator: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="idle-table">
      <h2>No active problem</h2>
      <p>
        {facilitator && !canCreate
          ? "This world is archived."
          : facilitator
            ? "Create a problem to begin."
            : "A facilitator can create the next problem."}
      </p>
      {canCreate ? (
        <button className="button button-play" type="button" onClick={onCreate}>
          New problem
        </button>
      ) : null}
    </section>
  );
}

function NewProblemModal({
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
    <Modal
      title="New problem"
      description="Describe the problem and choose who can respond."
      onClose={onClose}
    >
      <form
        className="modal-form problem-form"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Title" hint="Optional. Shown in history.">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={200}
            placeholder="Problem title"
          />
        </Field>
        <Field label="Description" error={error?.fields["prompt"]}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            rows={5}
            maxLength={10_000}
            placeholder="Describe the problem."
          />
        </Field>
        {world.dm_source === "terra" ? (
          <div className="auto-dm-generator">
            <span>
              Terra can propose the next problem from the current world and
              table history.
            </span>
            <button
              className="button button-quiet"
              type="button"
              disabled={generating || saving}
              onClick={() => void generateProblem()}
            >
              {generating
                ? "Generating…"
                : prompt.trim() === ""
                  ? "Generate problem"
                  : "Generate again"}
            </button>
          </div>
        ) : null}
        {entities.length > 0 ? (
          <fieldset className="choice-fieldset">
            <legend>
              Context entities <small>Optional</small>
            </legend>
            <div className="chip-picker">
              {entities
                .filter(
                  (entity) =>
                    !entity.archived &&
                    entity.character_status !== "setup-required",
                )
                .map((entity) => (
                  <label
                    key={entity.id}
                    className={entityIds.includes(entity.id) ? "selected" : ""}
                  >
                    <input
                      type="checkbox"
                      checked={entityIds.includes(entity.id)}
                      onChange={() =>
                        toggle(entityIds, entity.id, setEntityIds)
                      }
                    />
                    <span>{entity.display_name}</span>
                  </label>
                ))}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="choice-fieldset">
          <legend>Who may respond?</legend>
          <div className="responder-picker">
            {responders.length === 0 ? (
              <p>
                No active players are available. You can create a problem
                without responders.
              </p>
            ) : (
              responders.map((member) => (
                <label key={member.id}>
                  <input
                    type="checkbox"
                    checked={responderIds.includes(member.id)}
                    onChange={() =>
                      toggle(responderIds, member.id, setResponderIds)
                    }
                  />
                  <Avatar name={member.display_name} size="small" />
                  <span>{member.display_name}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>
        {error === null ? null : <ErrorMessage error={error} />}
        <footer className="modal-actions">
          <button
            className="button button-quiet"
            type="button"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-play"
            type="submit"
            disabled={saving || generating || prompt.trim() === ""}
          >
            {saving ? "Creating…" : "Create problem"}
          </button>
        </footer>
      </form>
    </Modal>
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
    <article className="live-interaction">
      <header>
        <div>
          <span className={`interaction-status status-${interaction.status}`}>
            <i aria-hidden="true" />
            {interaction.status === "open"
              ? "Accepting actions"
              : "Closed for actions"}
          </span>
          <span>
            Presented{" "}
            {formatRelativeDate(
              interaction.presented_at ?? interaction.created_at,
            )}
          </span>
        </div>
        {facilitator ? (
          <button
            className="text-button danger-text"
            type="button"
            disabled={working}
            onClick={() => void command("cancel")}
          >
            Cancel problem
          </button>
        ) : null}
      </header>
      <div className="problem-prompt">
        <h2>{interaction.title ?? "Problem"}</h2>
        <p className="prompt-copy">{interaction.prompt}</p>
        {context.length > 0 ? (
          <div className="context-chips">
            {context.map((entity) => (
              <span key={entity.id}>{entity.display_name}</span>
            ))}
          </div>
        ) : null}
      </div>

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
      {error === null ? null : <ErrorMessage error={error} />}
    </article>
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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
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
    <section className="action-stage">
      <header>
        <h3>Actions</h3>
        <p>
          {submitted.length === 0
            ? "No actions submitted"
            : `${submitted.length} ${submitted.length === 1 ? "action" : "actions"} submitted`}
        </p>
      </header>
      {submitted.length > 0 ? (
        <div className="action-list">
          {submitted.map((action) => (
            <blockquote key={action.id}>
              <Avatar
                name={
                  action.acting_entity_name ??
                  action.submitted_by_name ??
                  "Player"
                }
                size="small"
              />
              <div>
                <strong>
                  {action.acting_entity_name ??
                    action.submitted_by_name ??
                    "Player"}
                </strong>
                {action.acting_entity_name === undefined ? null : (
                  <small>
                    played by {action.submitted_by_name ?? "Player"}
                  </small>
                )}
                <p>{action.text}</p>
              </div>
            </blockquote>
          ))}
        </div>
      ) : null}
      {!facilitator && eligible ? (
        currentAction === undefined ? (
          <form
            className="action-composer"
            onSubmit={(event) => void submit(event)}
          >
            {controlledEntities.length === 0 ? null : (
              <Field label="Acting character">
                <select
                  value={actingEntityID}
                  onChange={(event) =>
                    setActingEntityID(event.currentTarget.value)
                  }
                >
                  <option value="">No character attribution</option>
                  {controlledEntities.map((entity) => (
                    <option key={entity.id} value={entity.id}>
                      {entity.display_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="What do you do?">
              <textarea
                value={text}
                onChange={(event) => setText(event.currentTarget.value)}
                rows={3}
                maxLength={10_000}
                placeholder="Describe your action."
              />
            </Field>
            <button
              className="button button-play"
              type="submit"
              disabled={saving || text.trim() === ""}
            >
              {saving ? "Submitting…" : "Submit action"}
            </button>
          </form>
        ) : (
          <div className="own-action">
            <span>Action submitted.</span>
            <button
              className="text-button"
              type="button"
              disabled={saving}
              onClick={() => void withdraw()}
            >
              Withdraw
            </button>
          </div>
        )
      ) : null}
      {!facilitator && !eligible ? (
        <p className="observer-note">
          You are part of this problem’s audience, but not one of its
          responders.
        </p>
      ) : null}
      {facilitator ? (
        <div className="adjudicate-callout">
          <div>
            <p>
              <strong>Close actions</strong>
              <small>
                Players cannot submit or withdraw actions after you close them.
              </small>
            </p>
          </div>
          <button
            className="button button-ink"
            type="button"
            disabled={working}
            onClick={onAdjudicate}
          >
            {working ? "Closing…" : "Close actions"}
          </button>
        </div>
      ) : null}
      {error === null ? null : <ErrorMessage error={error} />}
    </section>
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
    <section className="ruling-editor">
      <header>
        <h3>What transpires?</h3>
        <p>
          {terra
            ? "Terra considers the submitted actions and writes the outcome. Luna then translates it into the world’s mechanics."
            : "Describe the outcome in plain language. Luna will translate it into the world’s mechanics."}
        </p>
      </header>
      {submitted.length > 0 ? (
        <section className="consequence-actions" aria-label="Submitted actions">
          <h4>Actions to consider</h4>
          <div className="action-list">
            {submitted.map((action) => (
              <blockquote key={action.id}>
                <Avatar
                  name={
                    action.acting_entity_name ??
                    action.submitted_by_name ??
                    "Player"
                  }
                  size="small"
                />
                <div>
                  <strong>
                    {action.acting_entity_name ??
                      action.submitted_by_name ??
                      "Player"}
                  </strong>
                  <p>{action.text}</p>
                </div>
              </blockquote>
            ))}
          </div>
        </section>
      ) : null}
      <Field
        label="What transpires"
        hint={
          terra
            ? "Generated by Terra from the current problem, actions, and world."
            : "Include the fictional outcome and any lasting or mechanical consequences."
        }
        error={error?.fields["narrative"]}
      >
        <textarea
          value={narrative}
          readOnly={terra}
          onChange={(event) => {
            setNarrative(event.currentTarget.value);
            setCompilation(null);
            setError(null);
          }}
          rows={6}
          maxLength={20_000}
          placeholder={
            terra
              ? "Ask Terra to generate the consequence."
              : "Describe everything that happens as a result of these actions."
          }
        />
      </Field>
      {compiled === null ? null : (
        <>
          {selectedAction === undefined ? null : (
            <p className="compiled-action-summary">
              Centered on{" "}
              <strong>
                {selectedAction.acting_entity_name ??
                  selectedAction.submitted_by_name ??
                  "the selected action"}
              </strong>
              : {selectedAction.text}
            </p>
          )}
          <RulingPreview
            result={compiled.preview}
            entities={entities}
            mechanics={mechanics}
          />
        </>
      )}
      {!rulesReady ? (
        <p className="ruling-sync-notice" role="status">
          Refreshing the current rules and entity state before this consequence
          can be interpreted or resolved.
        </p>
      ) : compilation !== null && compiled === null ? (
        <p className="ruling-sync-notice" role="status">
          The outcome or table changed after this preview was prepared. Prepare
          it again before resolving.
        </p>
      ) : null}
      {error === null ? null : <ErrorMessage error={error} />}
      <footer className="ruling-actions">
        {terra ? (
          <button
            className="button button-quiet"
            type="button"
            disabled={saving !== null || !rulesReady}
            onClick={() => void prepareConsequence("generate")}
          >
            {saving === "generate"
              ? "Terra is deciding…"
              : compiled === null
                ? "Generate consequence"
                : "Generate again"}
          </button>
        ) : (
          <button
            className="button button-quiet"
            type="button"
            disabled={saving !== null || narrative.trim() === "" || !rulesReady}
            onClick={() => void prepareConsequence("compile")}
          >
            {saving === "compile"
              ? "Interpreting…"
              : compiled === null
                ? "Compile & preview"
                : "Compile again"}
          </button>
        )}
        <button
          className="button button-play"
          type="button"
          disabled={saving !== null || compiled === null || !rulesReady}
          onClick={() => void resolve()}
        >
          {saving === "resolve" ? "Resolving…" : "Resolve problem"}
        </button>
      </footer>
    </section>
  );
}
function RulingPreview({
  result,
  entities,
  mechanics,
}: {
  result: InteractionResolutionResult;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
}) {
  return (
    <div className="ruling-preview" role="status" aria-live="polite">
      <header>
        <div>
          <strong>Preview is valid</strong>
          <small>
            {result.applied_effects.length === 0
              ? "Narrative only"
              : `${result.applied_effects.length} state ${result.applied_effects.length === 1 ? "application" : "applications"}`}
          </small>
        </div>
      </header>
      {result.applied_effects.length > 0 ? (
        <div>
          {result.applied_effects.map((effect, index) => (
            <p key={`${effect.effect_id}-${effect.entity_id}-${index}`}>
              <strong>
                {entities.find((entity) => entity.id === effect.entity_id)
                  ?.display_name ?? "Entity"}
              </strong>
              <span>
                {effect.type === "apply-status"
                  ? `Applied ${effect.status_name ?? "status"}`
                  : effect.type === "remove-status"
                    ? `Removed ${effect.status_name ?? "status"}`
                    : (mechanics.find(
                        (mechanic) => mechanic.id === effect.mechanic_id,
                      )?.name ?? "Mechanic")}
              </span>
              {effect.type === "apply-status" ||
              effect.type === "remove-status" ? (
                <em>{effect.changed ? "changed" : "already current"}</em>
              ) : (
                <em>
                  {displayValue(effect.before)} → {displayValue(effect.after)}
                </em>
              )}
            </p>
          ))}
        </div>
      ) : null}
      {result.effective_changes.length > 0 ? (
        <div className="effective-change-list">
          <strong>Final calculated changes</strong>
          {result.effective_changes.map((change) => (
            <p key={`${change.entity_id}:${change.mechanic_id}`}>
              <span>
                {entities.find((entity) => entity.id === change.entity_id)
                  ?.display_name ?? "Entity"}
                {" · "}
                {mechanics.find(
                  (mechanic) => mechanic.id === change.mechanic_id,
                )?.name ?? "Mechanic"}
              </span>
              <em>
                {displayValue(change.before)} → {displayValue(change.after)}
              </em>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HistoryCard({
  interaction,
  entities,
  mechanics,
}: {
  interaction: Interaction;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
}) {
  if (interaction.status === "cancelled")
    return (
      <article className="history-card history-cancelled">
        <header>
          <span>Cancelled</span>
          <time>{formatRelativeDate(interaction.cancelled_at)}</time>
        </header>
        <h3>{interaction.title ?? "Untitled problem"}</h3>
        <p>{interaction.prompt}</p>
      </article>
    );
  const resolution = interaction.resolution;
  return (
    <article className="history-card">
      <header>
        <span>Resolved</span>
        <time>{formatRelativeDate(interaction.resolved_at)}</time>
      </header>
      <h3>{interaction.title ?? "Untitled problem"}</h3>
      <p className="history-prompt">{interaction.prompt}</p>
      {resolution === undefined ? null : (
        <>
          <blockquote>{resolution.narrative}</blockquote>
          {resolution.applied_effects.length > 0 ? (
            <div className="history-effects">
              {resolution.applied_effects.map((effect, index) => (
                <span key={`${effect.effect_id}-${effect.entity_id}-${index}`}>
                  {entities.find((entity) => entity.id === effect.entity_id)
                    ?.display_name ?? "Entity"}
                  :{" "}
                  {effect.type === "apply-status"
                    ? `applied ${effect.status_name ?? "status"}`
                    : effect.type === "remove-status"
                      ? `removed ${effect.status_name ?? "status"}`
                      : `${mechanics.find((item) => item.id === effect.mechanic_id)?.name ?? "mechanic"} ${displayValue(effect.before)} → ${displayValue(effect.after)}`}
                </span>
              ))}
            </div>
          ) : null}
          {resolution.effective_changes.length > 0 ? (
            <div className="history-effective-changes">
              <strong>Final values</strong>
              {resolution.effective_changes.map((change) => (
                <span key={`${change.entity_id}:${change.mechanic_id}`}>
                  {entities.find((entity) => entity.id === change.entity_id)
                    ?.display_name ?? "Entity"}
                  :{" "}
                  {mechanics.find(
                    (mechanic) => mechanic.id === change.mechanic_id,
                  )?.name ?? "mechanic"}{" "}
                  {displayValue(change.before)} → {displayValue(change.after)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
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
