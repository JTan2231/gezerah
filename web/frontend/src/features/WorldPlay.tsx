import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError, jsonBody, worldPath } from "../api/client";
import type {
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  StateValue,
  StatusModifierOperation,
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
import {
  effectToAPI,
  type EffectDraft,
  type StatusModifierDraft,
} from "../domain/consequences";
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
    return <LoadingState label="Setting the table" />;
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
        title="You are not at this table"
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
          <p className="eyebrow">
            <span className="live-dot" aria-hidden="true" /> Live world
          </p>
          <h1>{world.name}</h1>
          <p>
            {facilitator
              ? "Present a problem, hear the table, and make the ruling."
              : "The world changes when the table acts."}
          </p>
        </div>
        <div className="play-header-actions">
          <div className="table-role">
            <Avatar name={user.display_name} size="small" />
            <span>
              <small>Your seat</small>
              <strong>
                {facilitator ? "Dungeon Master" : humanize(membership.role)}
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
              <span aria-hidden="true">＋</span> New problem
            </button>
          ) : null}
        </div>
      </header>

      <div className="play-grid">
        <aside className="roster-panel">
          <header>
            <div>
              <p className="eyebrow">Roster</p>
              <h2>In this world</h2>
            </div>
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
              <span aria-hidden="true">○</span>
              <strong>No one is here yet</strong>
              <p>
                The world’s authors can prepare entities and generated sheets in
                Builder.
              </p>
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
              people at the table
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
            <LoadingState label="Reading the table" />
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
                <p className="eyebrow">Recent history</p>
                <h2>What became true</h2>
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
              description="Choose someone from the roster to open their generated sheet."
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
          <p className="eyebrow">Character onboarding</p>
          <h1>{world.name}</h1>
          <p>
            Welcome, {user.display_name}. Complete every field prescribed for a
            controlled character before entering the live table.
          </p>
        </div>
        <span className="character-status status-setup">
          {world.play_status === "waiting-for-character"
            ? "Waiting for a character"
            : "Setup required"}
        </span>
      </header>

      {loading && available.length === 0 ? (
        <LoadingState label="Looking for your character" />
      ) : null}
      {error === null ? null : <ErrorMessage error={error} onRetry={onRetry} />}
      {!loading && available.length === 0 ? (
        <div className="onboarding-waiting panel">
          <EmptyState
            title="Your character has not been assigned yet"
            description="You have joined the world, but you are not at the live table. A Dungeon Master needs to create an entity and assign you as a controller."
          />
        </div>
      ) : null}

      {selected === undefined ? null : (
        <div className="onboarding-layout">
          {available.length > 1 ? (
            <aside className="panel onboarding-characters">
              <p className="eyebrow">Your characters</p>
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
  onCreate,
}: {
  facilitator: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="idle-table">
      <div className="idle-rings" aria-hidden="true">
        <i />
        <i />
        <i />
        <span>✦</span>
      </div>
      <p className="eyebrow">The table is listening</p>
      <h2>
        {facilitator ? "What happens next?" : "Waiting for the next problem."}
      </h2>
      <p>
        {facilitator
          ? "Problems are born here—not in a library. Describe the moment when it arrives."
          : "The Dungeon Master will present the next moment when it is ready."}
      </p>
      {facilitator ? (
        <button className="button button-play" type="button" onClick={onCreate}>
          Present a problem
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
          : new ApiError(0, "unknown", "Could not present this problem."),
      );
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Present a problem"
      description="Describe this moment. It will never become a reusable template."
      onClose={onClose}
    >
      <form
        className="modal-form problem-form"
        onSubmit={(event) => void submit(event)}
      >
        <Field
          label="Short title"
          hint="Optional. Useful in the resolved history."
        >
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
            maxLength={200}
            placeholder="The bridge gives way"
          />
        </Field>
        <Field label="What is happening?" error={error?.fields["prompt"]}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
            rows={5}
            maxLength={10_000}
            placeholder="Rain has swollen the gorge. The center ropes snap, and the far half of the bridge begins to fold beneath you…"
          />
        </Field>
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
                No active players have joined yet. You can still present a
                narrative problem.
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
            disabled={saving || prompt.trim() === ""}
          >
            {saving ? "Presenting…" : "Present to the table"}
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
              "The table changed before that command completed.",
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
              ? "Open for actions"
              : "DM is ruling"}
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
        <p className="eyebrow">The problem</p>
        {interaction.title === undefined ? null : <h2>{interaction.title}</h2>}
        <p className="prompt-copy">{interaction.prompt}</p>
        {context.length > 0 ? (
          <div className="context-chips">
            {context.map((entity) => (
              <span key={entity.id}>
                <i aria-hidden="true">○</i>
                {entity.display_name}
              </span>
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
        <p className="eyebrow">Actions</p>
        <h3>
          {submitted.length === 0
            ? "The table is considering…"
            : `${submitted.length} ${submitted.length === 1 ? "action" : "actions"} offered`}
        </h3>
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
                placeholder="Describe your intent in your own words…"
              />
            </Field>
            <button
              className="button button-play"
              type="submit"
              disabled={saving || text.trim() === ""}
            >
              {saving ? "Offering…" : "Offer action"}
            </button>
          </form>
        ) : (
          <div className="own-action">
            <span>Your action is on the table.</span>
            <button
              className="text-button"
              type="button"
              disabled={saving}
              onClick={() => void withdraw()}
            >
              Withdraw it
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
            <span aria-hidden="true">✦</span>
            <p>
              <strong>Ready to make the ruling?</strong>
              <small>
                Closing actions moves this problem into private adjudication.
              </small>
            </p>
          </div>
          <button
            className="button button-ink"
            type="button"
            disabled={working}
            onClick={onAdjudicate}
          >
            {working ? "Closing…" : "Begin ruling"}
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
  const mutable = mechanics.filter(
    (mechanic) => mechanic.mutable_during_play && !mechanic.archived,
  );
  const submitted = interaction.actions.filter(
    (action) => action.status === "submitted",
  );
  const [selectedActionId, setSelectedActionId] = useState("");
  const [narrative, setNarrative] = useState("");
  const [effects, setEffects] = useState<EffectDraft[]>([]);
  const [preview, setPreview] = useState<{
    key: string;
    result: InteractionResolutionResult;
  } | null>(null);
  const [saving, setSaving] = useState<"preview" | "resolve" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const requestBody = {
    expected_revision: interaction.revision,
    expected_rules_revision: rulesRevision,
    selected_action_id: selectedActionId || undefined,
    narrative: narrative.trim(),
    effects: effects.map(effectToAPI),
  };
  const previewKey = JSON.stringify({
    ...requestBody,
    entity_versions: entities.map((entity) => [
      entity.id,
      entity.archived,
      entity.character_status,
      entity.state.revision,
      entity.state.status_revision,
      entity.state.rules_revision,
    ]),
  });
  const visiblePreview = preview?.key === previewKey ? preview.result : null;
  const effectsCurrent = effects.every((effect) =>
    effectDraftIsCurrent(effect, entities, mechanics),
  );

  async function adjudicate(mode: "preview" | "resolve") {
    const requestKey = previewKey;
    setSaving(mode);
    setError(null);
    try {
      const result = await api<InteractionResolutionResult>(
        worldPath(world.id, `interactions/${interaction.id}/${mode}`),
        {
          method: "POST",
          ...jsonBody({
            ...requestBody,
            idempotency_key: mode === "resolve" ? idempotencyKey : undefined,
          }),
        },
      );
      setPreview({ key: requestKey, result });
      if (mode === "resolve") onResolved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not complete this ruling."),
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="ruling-editor">
      <header>
        <p className="eyebrow">Dungeon Master ruling</p>
        <h3>Say what becomes true.</h3>
        <p>
          Choose an action if one drove the outcome, narrate it, and apply only
          the mechanical changes that matter.
        </p>
      </header>
      {submitted.length > 0 ? (
        <fieldset className="action-selection">
          <legend>
            Action at the center <small>Optional</small>
          </legend>
          <label className={selectedActionId === "" ? "selected" : ""}>
            <input
              type="radio"
              name="selected-action"
              checked={selectedActionId === ""}
              onChange={() => {
                setSelectedActionId("");
                setPreview(null);
              }}
            />
            <span>No single action</span>
          </label>
          {submitted.map((action) => (
            <label
              className={selectedActionId === action.id ? "selected" : ""}
              key={action.id}
            >
              <input
                type="radio"
                name="selected-action"
                checked={selectedActionId === action.id}
                onChange={() => {
                  setSelectedActionId(action.id);
                  setPreview(null);
                }}
              />
              <span>
                <strong>
                  {action.acting_entity_name ?? action.submitted_by_name}
                </strong>
                {action.acting_entity_name === undefined
                  ? null
                  : ` (${action.submitted_by_name})`}{" "}
                {action.text}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label="Consequence summary">
        <textarea
          value={narrative}
          onChange={(event) => {
            setNarrative(event.currentTarget.value);
            setPreview(null);
          }}
          rows={4}
          maxLength={20_000}
          placeholder="The rope catches, hard. Aria swings beneath the bridge, bruised but still holding on…"
        />
      </Field>
      <EffectBuilder
        entities={entities}
        mechanics={mechanics.filter((mechanic) => !mechanic.archived)}
        mutableMechanics={mutable}
        effects={effects}
        onChange={(nextEffects) => {
          setEffects(nextEffects);
          setPreview(null);
        }}
      />
      {visiblePreview === null ? null : (
        <RulingPreview
          result={visiblePreview}
          entities={entities}
          mechanics={mechanics}
        />
      )}
      {!rulesReady ? (
        <p className="ruling-sync-notice" role="status">
          Refreshing the current rules and entity state before this Consequence
          can be previewed or resolved.
        </p>
      ) : effectsCurrent ? null : (
        <p className="ruling-sync-notice" role="status">
          The table changed after an effect was added. Remove or rebuild the
          outdated effect before continuing.
        </p>
      )}
      {error === null ? null : <ErrorMessage error={error} />}
      <footer className="ruling-actions">
        <button
          className="button button-quiet"
          type="button"
          disabled={
            saving !== null ||
            narrative.trim() === "" ||
            !rulesReady ||
            !effectsCurrent
          }
          onClick={() => void adjudicate("preview")}
        >
          {saving === "preview" ? "Previewing…" : "Preview changes"}
        </button>
        <button
          className="button button-play"
          type="button"
          disabled={
            saving !== null ||
            narrative.trim() === "" ||
            !rulesReady ||
            !effectsCurrent
          }
          onClick={() => void adjudicate("resolve")}
        >
          {saving === "resolve" ? "Resolving…" : "Resolve problem"}
        </button>
      </footer>
    </section>
  );
}

function EffectBuilder({
  entities,
  mechanics,
  mutableMechanics,
  effects,
  onChange,
}: {
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  mutableMechanics: WorldMechanic[];
  effects: EffectDraft[];
  onChange: (effects: EffectDraft[]) => void;
}) {
  const eligibleEntities = entities.filter(
    (entity) =>
      !entity.archived && entity.character_status !== "setup-required",
  );
  const eligibleEntityIDs = new Set(
    eligibleEntities.map((entity) => entity.id),
  );
  const activeStatusOptions = eligibleEntities.flatMap((entity) =>
    entity.state.active_statuses.map((status) => ({
      key: `${entity.id}:${status.id}`,
      entity,
      status,
    })),
  );
  const queuedRemovalIDs = new Set(
    effects
      .filter((effect) => effect.kind === "remove-status")
      .flatMap((effect) =>
        effect.targets.map((target) => target.statusInstanceId),
      ),
  );
  const removableStatusOptions = activeStatusOptions.filter(
    ({ status }) => !queuedRemovalIDs.has(status.id),
  );
  const firstMechanic = mutableMechanics[0];
  const [entityId, setEntityId] = useState(eligibleEntities[0]?.id ?? "");
  const [effectKind, setEffectKind] = useState<
    "mechanic" | "apply-status" | "remove-status"
  >(firstMechanic === undefined ? "apply-status" : "mechanic");
  const [mechanicId, setMechanicId] = useState(firstMechanic?.id ?? "");
  const [operation, setOperation] = useState<"adjust-number" | "set">(
    firstMechanic?.mode === "binary" ? "set" : "adjust-number",
  );
  const [amount, setAmount] = useState(0);
  const [booleanValue, setBooleanValue] = useState(true);
  const [statusName, setStatusName] = useState("");
  const [statusDescription, setStatusDescription] = useState("");
  const [statusTargetIds, setStatusTargetIds] = useState<string[]>(
    eligibleEntities[0] === undefined ? [] : [eligibleEntities[0].id],
  );
  const [statusModifiers, setStatusModifiers] = useState<StatusModifierDraft[]>(
    [],
  );
  const [removalKey, setRemovalKey] = useState(
    removableStatusOptions[0]?.key ?? "",
  );
  const effectiveEntityId =
    entityId !== "" && eligibleEntityIDs.has(entityId)
      ? entityId
      : (eligibleEntities[0]?.id ?? "");
  const effectiveMechanicId =
    mechanicId !== "" ? mechanicId : (firstMechanic?.id ?? "");
  const mechanic = mutableMechanics.find(
    (item) => item.id === effectiveMechanicId,
  );
  const effectiveRemoval =
    removableStatusOptions.find((option) => option.key === removalKey) ??
    removableStatusOptions[0];
  const currentStatusTargetIds = statusTargetIds.filter((id) =>
    eligibleEntityIDs.has(id),
  );
  const statusModifiersCurrent = statusModifiers.every((modifier) =>
    statusModifierIsCurrent(modifier, mechanics),
  );

  function chooseMechanic(id: string) {
    setMechanicId(id);
    const selected = mutableMechanics.find((item) => item.id === id);
    setOperation(selected?.mode === "binary" ? "set" : "adjust-number");
    setAmount(0);
  }

  function addMechanicEffect() {
    if (effectiveEntityId === "") return;
    if (mechanic === undefined) return;
    onChange([
      ...effects,
      {
        id: crypto.randomUUID(),
        entityId: effectiveEntityId,
        kind: "mechanic",
        mechanicId: effectiveMechanicId,
        valueKind: mechanic.mode === "binary" ? "boolean" : "number",
        operation: mechanic.mode === "binary" ? "set" : operation,
        amount,
        booleanValue,
      },
    ]);
    setAmount(0);
  }

  function addStatusEffect() {
    if (
      statusName.trim() === "" ||
      currentStatusTargetIds.length === 0 ||
      !statusModifiersCurrent
    )
      return;
    onChange([
      ...effects,
      {
        id: crypto.randomUUID(),
        kind: "apply-status",
        entityIds: currentStatusTargetIds,
        status: {
          name: statusName.trim(),
          description: statusDescription.trim(),
          modifiers: statusModifiers,
        },
      },
    ]);
    setStatusName("");
    setStatusDescription("");
    setStatusModifiers([]);
  }

  function addRemovalEffect() {
    if (effectiveRemoval === undefined) return;
    onChange([
      ...effects,
      {
        id: crypto.randomUUID(),
        kind: "remove-status",
        targets: [
          {
            entityId: effectiveRemoval.entity.id,
            statusInstanceId: effectiveRemoval.status.id,
            statusName: effectiveRemoval.status.name,
          },
        ],
      },
    ]);
    setRemovalKey("");
  }

  function toggleStatusTarget(id: string) {
    setStatusTargetIds((current) =>
      current.includes(id)
        ? current.filter((candidate) => candidate !== id)
        : [...current, id],
    );
  }

  function setModifier(index: number, modifier: StatusModifierDraft) {
    setStatusModifiers((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? modifier : candidate,
      ),
    );
  }

  return (
    <section className="effect-builder">
      <header>
        <div>
          <p className="eyebrow">Consequence effects</p>
          <h4>What becomes true mechanically?</h4>
        </div>
        <span>
          {effects.length} {effects.length === 1 ? "effect" : "effects"}
        </span>
      </header>
      {eligibleEntities.length === 0 ? (
        <p className="effect-empty">
          At least one play-ready entity is required for a mechanical
          consequence. Narrative-only rulings are always valid.
        </p>
      ) : (
        <>
          <select
            className="consequence-kind-select"
            value={effectKind}
            onChange={(event) =>
              setEffectKind(event.currentTarget.value as typeof effectKind)
            }
            aria-label="Consequence effect kind"
          >
            {mutableMechanics.length > 0 ? (
              <option value="mechanic">Change a value</option>
            ) : null}
            <option value="apply-status">Create a lasting status</option>
            {activeStatusOptions.length > 0 ? (
              <option value="remove-status">End an active status</option>
            ) : null}
          </select>
          {effectKind === "mechanic" ? (
            <div className="effect-composer">
              <select
                value={effectiveEntityId}
                onChange={(event) => setEntityId(event.currentTarget.value)}
                aria-label="Effect entity"
              >
                {eligibleEntities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.display_name}
                  </option>
                ))}
              </select>
              <select
                value={effectiveMechanicId}
                onChange={(event) => chooseMechanic(event.currentTarget.value)}
                aria-label="Effect mechanic"
              >
                {mutableMechanics.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              {mechanic?.mode === "binary" ? (
                <select
                  value={String(booleanValue)}
                  onChange={(event) =>
                    setBooleanValue(event.currentTarget.value === "true")
                  }
                  aria-label="Capability change"
                >
                  <option value="true">Grant</option>
                  <option value="false">Remove</option>
                </select>
              ) : (
                <>
                  <select
                    value={operation}
                    onChange={(event) =>
                      setOperation(
                        event.currentTarget.value as "adjust-number" | "set",
                      )
                    }
                    aria-label="Effect operation"
                  >
                    <option value="adjust-number">Adjust by</option>
                    <option value="set">Set to</option>
                  </select>
                  <input
                    type="number"
                    value={amount}
                    onChange={(event) =>
                      setAmount(event.currentTarget.valueAsNumber || 0)
                    }
                    step="any"
                    aria-label="Effect amount"
                  />
                </>
              )}
              <button
                className="button button-ink"
                type="button"
                onClick={addMechanicEffect}
                disabled={mechanic === undefined}
              >
                Add effect
              </button>
            </div>
          ) : effectKind === "apply-status" ? (
            <div className="status-consequence-composer">
              <div className="status-consequence-fields">
                <label>
                  <span>Status name</span>
                  <input
                    value={statusName}
                    maxLength={200}
                    onChange={(event) =>
                      setStatusName(event.currentTarget.value)
                    }
                    placeholder="Shaken"
                  />
                </label>
                <label>
                  <span>
                    Description <small>Optional</small>
                  </span>
                  <textarea
                    value={statusDescription}
                    maxLength={2000}
                    rows={2}
                    onChange={(event) =>
                      setStatusDescription(event.currentTarget.value)
                    }
                    placeholder="What this consequence means in the fiction."
                  />
                </label>
              </div>
              <fieldset className="consequence-targets">
                <legend>Targets</legend>
                <div>
                  {eligibleEntities.map((entity) => (
                    <label
                      className={
                        statusTargetIds.includes(entity.id) ? "selected" : ""
                      }
                      key={entity.id}
                    >
                      <input
                        type="checkbox"
                        checked={statusTargetIds.includes(entity.id)}
                        onChange={() => toggleStatusTarget(entity.id)}
                      />
                      <span>{entity.display_name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <section className="status-consequence-modifiers">
                <header>
                  <div>
                    <strong>Typed modifiers</strong>
                    <small>
                      Optional. Lower priorities run first; ties follow this
                      order.
                    </small>
                  </div>
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={mechanics.length === 0}
                    onClick={() => {
                      const target = mechanics[0];
                      if (target === undefined) return;
                      setStatusModifiers((current) => [
                        ...current,
                        newStatusModifier(target),
                      ]);
                    }}
                  >
                    ＋ Add modifier
                  </button>
                </header>
                {statusModifiers.length === 0 ? (
                  <p className="status-modifier-empty">
                    This can remain a named fictional condition with no numeric
                    modifier.
                  </p>
                ) : (
                  <ol className="status-modifier-list">
                    {statusModifiers.map((modifier, index) => (
                      <li key={modifier.id}>
                        <StatusModifierEditor
                          modifier={modifier}
                          mechanics={mechanics}
                          onChange={(next) => setModifier(index, next)}
                        />
                        <div className="modifier-order-actions">
                          <button
                            type="button"
                            aria-label={`Move modifier ${index + 1} up`}
                            disabled={index === 0}
                            onClick={() =>
                              setStatusModifiers((current) =>
                                moveItem(current, index, index - 1),
                              )
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move modifier ${index + 1} down`}
                            disabled={index === statusModifiers.length - 1}
                            onClick={() =>
                              setStatusModifiers((current) =>
                                moveItem(current, index, index + 1),
                              )
                            }
                          >
                            ↓
                          </button>
                          <button
                            className="danger-text"
                            type="button"
                            onClick={() =>
                              setStatusModifiers((current) =>
                                current.filter(
                                  (_candidate, candidateIndex) =>
                                    candidateIndex !== index,
                                ),
                              )
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <button
                className="button button-ink status-consequence-add"
                type="button"
                onClick={addStatusEffect}
                disabled={
                  statusName.trim() === "" ||
                  currentStatusTargetIds.length === 0 ||
                  !statusModifiersCurrent
                }
              >
                Add status effect
              </button>
              {statusModifiersCurrent ? null : (
                <p className="field-message" role="status">
                  A modifier has an unavailable target, a mismatched literal, or
                  a non-whole priority. Review it before adding this effect.
                </p>
              )}
            </div>
          ) : (
            <div className="effect-composer remove-status-composer">
              <select
                value={effectiveRemoval?.key ?? ""}
                onChange={(event) => setRemovalKey(event.currentTarget.value)}
                aria-label="Active status instance"
              >
                {removableStatusOptions.length === 0 ? (
                  <option value="">No unplanned active statuses</option>
                ) : null}
                {removableStatusOptions.map(({ key, entity, status }) => (
                  <option key={key} value={key}>
                    {entity.display_name} · {status.name} · applied{" "}
                    {formatRelativeDate(status.applied_at)} · instance{" "}
                    {shortIdentifier(status.id)}
                  </option>
                ))}
              </select>
              <button
                className="button button-ink"
                type="button"
                onClick={addRemovalEffect}
                disabled={effectiveRemoval === undefined}
              >
                Add effect
              </button>
            </div>
          )}
        </>
      )}
      {effects.length > 0 ? (
        <ol className="effect-list">
          {effects.map((effect) => {
            const item =
              effect.kind === "mechanic"
                ? mechanics.find(
                    (candidate) => candidate.id === effect.mechanicId,
                  )
                : undefined;
            return (
              <li key={effect.id}>
                <span
                  className={`effect-kind effect-${
                    effect.kind === "mechanic" ? item?.kind : "status"
                  }`}
                  aria-hidden="true"
                >
                  {effect.kind === "mechanic"
                    ? item?.kind === "capacity"
                      ? "◇"
                      : "✦"
                    : "◈"}
                </span>
                <div>
                  <strong>{effectTargetLabel(effect, entities)}</strong>
                  <span>{effectDescription(effect, item)}</span>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Remove effect"
                  onClick={() =>
                    onChange(
                      effects.filter((candidate) => candidate.id !== effect.id),
                    )
                  }
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}

function StatusModifierEditor({
  modifier,
  mechanics,
  onChange,
}: {
  modifier: StatusModifierDraft;
  mechanics: WorldMechanic[];
  onChange: (modifier: StatusModifierDraft) => void;
}) {
  const mechanic = mechanics.find((item) => item.id === modifier.mechanic_id);
  const numeric = mechanic?.mode !== "binary";
  return (
    <div className="status-modifier">
      <label>
        <span>Target value</span>
        <select
          value={modifier.mechanic_id}
          onChange={(event) => {
            const nextMechanic = mechanics.find(
              (candidate) => candidate.id === event.currentTarget.value,
            );
            if (nextMechanic === undefined) return;
            const nextNumeric = nextMechanic.mode !== "binary";
            onChange({
              ...modifier,
              mechanic_id: nextMechanic.id,
              operation: nextNumeric ? "add-number" : "set",
              value: nextNumeric
                ? { kind: "number", value: 0 }
                : { kind: "boolean", value: true },
            });
          }}
        >
          {mechanics.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Operation</span>
        <select
          value={modifier.operation}
          onChange={(event) =>
            onChange({
              ...modifier,
              operation: event.currentTarget.value as StatusModifierOperation,
            })
          }
        >
          <option value="set">Set to</option>
          {numeric ? <option value="add-number">Add</option> : null}
          {numeric ? (
            <option value="multiply-number">Multiply by</option>
          ) : null}
        </select>
      </label>
      <label>
        <span>Literal value</span>
        {numeric ? (
          <input
            type="number"
            step="any"
            value={modifier.value.kind === "number" ? modifier.value.value : 0}
            onChange={(event) =>
              onChange({
                ...modifier,
                value: {
                  kind: "number",
                  value: event.currentTarget.valueAsNumber || 0,
                },
              })
            }
          />
        ) : (
          <select
            value={
              modifier.value.kind === "boolean"
                ? String(modifier.value.value)
                : "true"
            }
            onChange={(event) =>
              onChange({
                ...modifier,
                operation: "set",
                value: {
                  kind: "boolean",
                  value: event.currentTarget.value === "true",
                },
              })
            }
          >
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        )}
      </label>
      <label>
        <span>Priority</span>
        <input
          type="number"
          step="1"
          value={modifier.priority}
          onChange={(event) =>
            onChange({
              ...modifier,
              priority: event.currentTarget.valueAsNumber || 0,
            })
          }
        />
      </label>
    </div>
  );
}

function newStatusModifier(mechanic: WorldMechanic): StatusModifierDraft {
  const numeric = mechanic.mode !== "binary";
  return {
    id: crypto.randomUUID(),
    mechanic_id: mechanic.id,
    operation: numeric ? "add-number" : "set",
    value: numeric
      ? { kind: "number", value: 0 }
      : { kind: "boolean", value: true },
    priority: 0,
  };
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
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
        <span aria-hidden="true">✓</span>
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
      <h3>{interaction.title ?? "A problem at the table"}</h3>
      <p className="history-prompt">{interaction.prompt}</p>
      {resolution === undefined ? null : (
        <>
          <blockquote>{resolution.narrative}</blockquote>
          {resolution.applied_effects.length > 0 ? (
            <div className="history-effects">
              {resolution.applied_effects.map((effect, index) => (
                <span key={`${effect.effect_id}-${effect.entity_id}-${index}`}>
                  <i aria-hidden="true">
                    {effect.type === "apply-status" ||
                    effect.type === "remove-status"
                      ? "◈"
                      : mechanics.find((item) => item.id === effect.mechanic_id)
                            ?.kind === "capacity"
                        ? "◇"
                        : "✦"}
                  </i>
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

function effectDraftIsCurrent(
  effect: EffectDraft,
  entities: WorldEntity[],
  mechanics: WorldMechanic[],
): boolean {
  const eligibleEntityIDs = new Set(
    entities
      .filter(
        (entity) =>
          !entity.archived && entity.character_status !== "setup-required",
      )
      .map((entity) => entity.id),
  );
  if (effect.kind === "mechanic") {
    const mechanic = mechanics.find(
      (candidate) => candidate.id === effect.mechanicId,
    );
    return (
      eligibleEntityIDs.has(effect.entityId) &&
      mechanic !== undefined &&
      !mechanic.archived &&
      mechanic.mutable_during_play &&
      effect.valueKind ===
        (mechanic.mode === "binary" ? "boolean" : "number") &&
      (effect.valueKind === "boolean" || Number.isFinite(effect.amount))
    );
  }
  if (effect.kind === "apply-status")
    return (
      effect.entityIds.length > 0 &&
      effect.entityIds.every((id) => eligibleEntityIDs.has(id)) &&
      effect.status.modifiers.every((modifier) =>
        statusModifierIsCurrent(modifier, mechanics),
      )
    );
  return (
    effect.targets.length > 0 &&
    effect.targets.every((target) => {
      if (!eligibleEntityIDs.has(target.entityId)) return false;
      return (
        entities
          .find((entity) => entity.id === target.entityId)
          ?.state.active_statuses.some(
            (status) => status.id === target.statusInstanceId,
          ) ?? false
      );
    })
  );
}

function statusModifierIsCurrent(
  modifier: StatusModifierDraft,
  mechanics: WorldMechanic[],
): boolean {
  const mechanic = mechanics.find(
    (candidate) => candidate.id === modifier.mechanic_id,
  );
  if (
    mechanic === undefined ||
    mechanic.archived ||
    !Number.isInteger(modifier.priority)
  )
    return false;
  const numeric = mechanic.mode !== "binary";
  if (modifier.operation === "set")
    return (
      modifier.value.kind === (numeric ? "number" : "boolean") &&
      (modifier.value.kind === "boolean" ||
        Number.isFinite(modifier.value.value))
    );
  return (
    numeric &&
    modifier.value.kind === "number" &&
    Number.isFinite(modifier.value.value)
  );
}

function effectDescription(
  effect: EffectDraft,
  mechanic?: WorldMechanic,
): string {
  if (effect.kind === "apply-status") {
    const count = effect.status.modifiers.length;
    return `Apply ${effect.status.name}${count === 0 ? "" : ` · ${count} ${count === 1 ? "modifier" : "modifiers"}`}`;
  }
  if (effect.kind === "remove-status")
    return `Remove ${effect.targets[0]?.statusName ?? "status"} · instance ${shortIdentifier(effect.targets[0]?.statusInstanceId ?? "unknown")}`;
  if (mechanic === undefined) return "Unknown mechanic";
  if (effect.valueKind === "boolean")
    return `${effect.booleanValue ? "Grant" : "Remove"} ${mechanic.name}`;
  return `${effect.operation === "set" ? "Set" : "Adjust"} ${mechanic.name} ${effect.operation === "adjust-number" && effect.amount >= 0 ? "+" : ""}${effect.amount}`;
}

function effectTargetLabel(
  effect: EffectDraft,
  entities: WorldEntity[],
): string {
  const ids =
    effect.kind === "mechanic"
      ? [effect.entityId]
      : effect.kind === "apply-status"
        ? effect.entityIds
        : effect.targets.map((target) => target.entityId);
  const names = ids.map(
    (id) =>
      entities.find((entity) => entity.id === id)?.display_name ?? "Entity",
  );
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} + ${names.length - 1} others`;
}

function displayValue(value?: StateValue): string {
  if (value === undefined) return "unknown";
  return value.kind === "number"
    ? String(value.value)
    : value.value
      ? "yes"
      : "no";
}

function shortIdentifier(id: string): string {
  return id.slice(0, 8);
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
