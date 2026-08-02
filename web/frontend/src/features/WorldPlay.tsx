import { useCallback, useMemo, useState } from "react";

import { api, ApiError, gamePath, jsonBody, worldPath } from "../api/client";
import type {
  ConcreteEffect,
  Game,
  GameMembership,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  StateScalarValue,
  StateValue,
  User,
  World,
  WorldEntity,
  WorldMechanic,
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
import { useGameEvents } from "../hooks/useGameEvents";
import { useResource } from "../hooks/useResource";

export function WorldPlay({ world, user }: { world: World; user: User }) {
  const game = useResource<Game>(gamePath(world.primary_game_id));
  const entities = useCollection<WorldEntity>(worldPath(world.id, "entities"));
  const mechanics = useCollection<WorldMechanic>(
    worldPath(world.id, "mechanics"),
  );
  const interactions = useCollection<Interaction>(
    gamePath(world.primary_game_id, "interactions"),
  );
  const [creatingProblem, setCreatingProblem] = useState(false);
  const [addingEntity, setAddingEntity] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<
    string | undefined
  >();
  const reloadGame = game.reload;
  const reloadEntities = entities.reload;
  const reloadInteractions = interactions.reload;

  const refresh = useCallback(() => {
    reloadGame();
    reloadEntities();
    reloadInteractions();
  }, [reloadEntities, reloadGame, reloadInteractions]);
  useGameEvents(world.primary_game_id, refresh);

  if (game.loading && game.value === null)
    return <LoadingState label="Setting the table" />;
  if (game.error !== null)
    return <ErrorMessage error={game.error} onRetry={game.reload} />;
  if (game.value === null) return null;

  const membership = game.value.memberships.find(
    (item) => item.user_id === user.id && item.status === "active",
  );
  if (membership === undefined)
    return (
      <EmptyState
        title="You are not at this table"
        description="An active world membership is required to enter play."
      />
    );
  const facilitator = membership.role === "facilitator";
  const active = interactions.items.find(
    (item) =>
      item.status === "open" ||
      item.status === "adjudicating" ||
      item.status === "draft",
  );
  const history = interactions.items.filter(
    (item) => item.status === "resolved" || item.status === "cancelled",
  );
  const selectedEntity =
    entities.items.find((item) => item.id === selectedEntityId) ??
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
                {membership.role === "facilitator"
                  ? "Dungeon Master"
                  : humanize(membership.role)}
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
            {facilitator ? (
              <button
                className="icon-button"
                type="button"
                aria-label="Create entity"
                onClick={() => setAddingEntity(true)}
              >
                ＋
              </button>
            ) : null}
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
                  className={
                    selectedEntity?.id === entity.id
                      ? "roster-item active"
                      : "roster-item"
                  }
                  type="button"
                  key={entity.id}
                  onClick={() => setSelectedEntityId(entity.id)}
                >
                  <span className="entity-token" aria-hidden="true">
                    {entity.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>
                    <strong>{entity.display_name}</strong>
                    <small>{entitySubtitle(entity, mechanics.items)}</small>
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
                Create an entity and its sheet will be generated from this
                world’s mechanics.
              </p>
              {facilitator ? (
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={() => setAddingEntity(true)}
                >
                  Create entity
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="table-members">
            <p>
              {
                game.value.memberships.filter(
                  (item) => item.status === "active",
                ).length
              }{" "}
              people at the table
            </p>
            <div>
              {game.value.memberships
                .filter((item) => item.status === "active")
                .slice(0, 6)
                .map((item) => (
                  <Avatar
                    key={item.id}
                    name={
                      item.display_name ?? item.user?.display_name ?? "Member"
                    }
                    size="small"
                  />
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
              game={game.value}
              membership={membership}
              entities={entities.items}
              mechanics={mechanics.items}
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
                  mechanics={mechanics.items}
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
            <EntitySheet
              key={`${selectedEntity.id}:${selectedEntity.state.revision}:${mechanics.items.map((mechanic) => mechanic.id).join(":")}`}
              entity={selectedEntity}
              mechanics={mechanics.items}
              editable={facilitator && world.status === "active"}
              world={world}
              onSaved={entities.reload}
            />
          )}
        </aside>
      </div>

      {creatingProblem ? (
        <NewProblemModal
          game={game.value}
          entities={entities.items}
          onClose={() => setCreatingProblem(false)}
          onCreated={() => {
            setCreatingProblem(false);
            refresh();
          }}
        />
      ) : null}
      {addingEntity ? (
        <NewEntityModal
          world={world}
          onClose={() => setAddingEntity(false)}
          onCreated={(entity) => {
            entities.replaceItem(entity, (item) => item.id);
            setSelectedEntityId(entity.id);
            setAddingEntity(false);
          }}
        />
      ) : null}
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
  game,
  entities,
  onClose,
  onCreated,
}: {
  game: Game;
  entities: WorldEntity[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const activeMembers = game.memberships.filter(
    (member) => member.status === "active",
  );
  const responders = activeMembers.filter((member) => member.role === "player");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [responderIds, setResponderIds] = useState(
    responders.map((member) => member.id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

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
      await api<Interaction>(gamePath(game.id, "interactions"), {
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
                .filter((entity) => !entity.archived)
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
                  <Avatar
                    name={
                      member.display_name ??
                      member.user?.display_name ??
                      "Player"
                    }
                    size="small"
                  />
                  <span>
                    {member.display_name ?? member.user?.display_name}
                  </span>
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

function NewEntityModal({
  world,
  onClose,
  onCreated,
}: {
  world: World;
  onClose: () => void;
  onCreated: (entity: WorldEntity) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const entity = await api<WorldEntity>(worldPath(world.id, "entities"), {
        method: "POST",
        ...jsonBody({ display_name: name.trim() }),
      });
      onCreated(entity);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this entity."),
      );
      setSaving(false);
    }
  }
  return (
    <Modal
      title="Create an entity"
      description="Its sheet is generated from every active capacity and capability."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={(event) => void submit(event)}>
        <Field label="Display name" error={error?.fields["display_name"]}>
          <input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            maxLength={200}
            placeholder="Aria Vale"
          />
        </Field>
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
            className="button button-primary"
            type="submit"
            disabled={saving || name.trim() === ""}
          >
            {saving ? "Creating…" : "Create entity"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function LiveInteraction({
  interaction,
  game,
  membership,
  entities,
  mechanics,
  facilitator,
  onChanged,
}: {
  interaction: Interaction;
  game: Game;
  membership: GameMembership;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
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
        gamePath(game.id, `interactions/${interaction.id}/${action}`),
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
          game={game}
          membership={membership}
          facilitator={facilitator}
          working={working}
          onAdjudicate={() => void command("adjudicate")}
          onChanged={onChanged}
        />
      ) : null}
      {interaction.status === "adjudicating" && facilitator ? (
        <RulingEditor
          interaction={interaction}
          game={game}
          entities={entities}
          mechanics={mechanics}
          onResolved={onChanged}
        />
      ) : null}
      {error === null ? null : <ErrorMessage error={error} />}
    </article>
  );
}

function OpenProblem({
  interaction,
  game,
  membership,
  facilitator,
  working,
  onAdjudicate,
  onChanged,
}: {
  interaction: Interaction;
  game: Game;
  membership: GameMembership;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        gamePath(game.id, `interactions/${interaction.id}/actions`),
        {
          method: "POST",
          ...jsonBody({
            text: text.trim(),
            expected_revision: interaction.revision,
          }),
        },
      );
      setText("");
      onChanged();
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
        gamePath(
          game.id,
          `interactions/${interaction.id}/actions/${currentAction.id}/withdraw`,
        ),
        {
          method: "POST",
          ...jsonBody({ expected_revision: currentAction.revision }),
        },
      );
      onChanged();
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
                name={action.submitted_by_name ?? "Player"}
                size="small"
              />
              <div>
                <strong>{action.submitted_by_name ?? "Player"}</strong>
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

interface EffectDraft {
  id: string;
  entityId: string;
  mechanicId: string;
  operation: "adjust-number" | "set";
  amount: number;
  booleanValue: boolean;
}

function RulingEditor({
  interaction,
  game,
  entities,
  mechanics,
  onResolved,
}: {
  interaction: Interaction;
  game: Game;
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
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
  const [preview, setPreview] = useState<InteractionResolutionResult | null>(
    null,
  );
  const [saving, setSaving] = useState<"preview" | "resolve" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function adjudicate(mode: "preview" | "resolve") {
    setSaving(mode);
    setError(null);
    try {
      const result = await api<InteractionResolutionResult>(
        gamePath(game.id, `interactions/${interaction.id}/${mode}`),
        {
          method: "POST",
          ...jsonBody({
            expected_revision: interaction.revision,
            idempotency_key: mode === "resolve" ? idempotencyKey : undefined,
            selected_action_id: selectedActionId || undefined,
            narrative: narrative.trim(),
            effects: effects.map((effect) => effectToAPI(effect, mechanics)),
          }),
        },
      );
      setPreview(result);
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
              onChange={() => setSelectedActionId("")}
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
                onChange={() => setSelectedActionId(action.id)}
              />
              <span>
                <strong>{action.submitted_by_name}</strong>
                {action.text}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <Field label="Public outcome">
        <textarea
          value={narrative}
          onChange={(event) => setNarrative(event.currentTarget.value)}
          rows={4}
          maxLength={20_000}
          placeholder="The rope catches, hard. Aria swings beneath the bridge, bruised but still holding on…"
        />
      </Field>
      <EffectBuilder
        entities={entities}
        mechanics={mutable}
        effects={effects}
        onChange={setEffects}
      />
      {preview === null ? null : (
        <RulingPreview
          result={preview}
          entities={entities}
          mechanics={mechanics}
        />
      )}
      {error === null ? null : <ErrorMessage error={error} />}
      <footer className="ruling-actions">
        <button
          className="button button-quiet"
          type="button"
          disabled={saving !== null || narrative.trim() === ""}
          onClick={() => void adjudicate("preview")}
        >
          {saving === "preview" ? "Previewing…" : "Preview changes"}
        </button>
        <button
          className="button button-play"
          type="button"
          disabled={saving !== null || narrative.trim() === ""}
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
  effects,
  onChange,
}: {
  entities: WorldEntity[];
  mechanics: WorldMechanic[];
  effects: EffectDraft[];
  onChange: (effects: EffectDraft[]) => void;
}) {
  const firstMechanic = mechanics[0];
  const [entityId, setEntityId] = useState(entities[0]?.id ?? "");
  const [mechanicId, setMechanicId] = useState(firstMechanic?.id ?? "");
  const [operation, setOperation] = useState<"adjust-number" | "set">(
    firstMechanic?.mode === "binary" ? "set" : "adjust-number",
  );
  const [amount, setAmount] = useState(0);
  const [booleanValue, setBooleanValue] = useState(true);
  const effectiveEntityId =
    entityId !== ""
      ? entityId
      : (entities.find((entity) => !entity.archived)?.id ?? "");
  const effectiveMechanicId =
    mechanicId !== "" ? mechanicId : (firstMechanic?.id ?? "");
  const mechanic = mechanics.find((item) => item.id === effectiveMechanicId);

  function chooseMechanic(id: string) {
    setMechanicId(id);
    const selected = mechanics.find((item) => item.id === id);
    setOperation(selected?.mode === "binary" ? "set" : "adjust-number");
    setAmount(0);
  }

  function add() {
    if (effectiveEntityId === "" || mechanic === undefined) return;
    onChange([
      ...effects,
      {
        id: crypto.randomUUID(),
        entityId: effectiveEntityId,
        mechanicId: effectiveMechanicId,
        operation: mechanic.mode === "binary" ? "set" : operation,
        amount,
        booleanValue,
      },
    ]);
    setAmount(0);
  }

  return (
    <section className="effect-builder">
      <header>
        <div>
          <p className="eyebrow">Mechanical effects</p>
          <h4>What changed?</h4>
        </div>
        <span>
          {effects.length} {effects.length === 1 ? "effect" : "effects"}
        </span>
      </header>
      {mechanics.length === 0 || entities.length === 0 ? (
        <p className="effect-empty">
          Create a mutable mechanic and at least one entity to apply mechanical
          effects. Narrative-only rulings are always valid.
        </p>
      ) : (
        <div className="effect-composer">
          <select
            value={effectiveEntityId}
            onChange={(event) => setEntityId(event.currentTarget.value)}
            aria-label="Effect entity"
          >
            {entities
              .filter((entity) => !entity.archived)
              .map((entity) => (
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
            {mechanics.map((item) => (
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
          <button className="button button-ink" type="button" onClick={add}>
            Add
          </button>
        </div>
      )}
      {effects.length > 0 ? (
        <ol className="effect-list">
          {effects.map((effect) => {
            const entity = entities.find((item) => item.id === effect.entityId);
            const item = mechanics.find(
              (candidate) => candidate.id === effect.mechanicId,
            );
            return (
              <li key={effect.id}>
                <span
                  className={`effect-kind effect-${item?.kind}`}
                  aria-hidden="true"
                >
                  {item?.kind === "capacity" ? "◇" : "✦"}
                </span>
                <div>
                  <strong>{entity?.display_name}</strong>
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
    <div className="ruling-preview">
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
                {mechanics.find(
                  (mechanic) => mechanic.id === effect.state_variable_id,
                )?.name ?? "Mechanic"}
              </span>
              <em>
                {displayValue(effect.before)} → {displayValue(effect.after)}
              </em>
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EntitySheet({
  entity,
  mechanics,
  editable,
  world,
  onSaved,
}: {
  entity: WorldEntity;
  mechanics: WorldMechanic[];
  editable: boolean;
  world: World;
  onSaved: () => void;
}) {
  const activeMechanics = mechanics.filter((mechanic) => !mechanic.archived);
  const initial = useMemo(
    () =>
      Object.fromEntries(
        activeMechanics.map((mechanic) => [
          mechanic.id,
          mechanicValue(entity.state.values[mechanic.id], mechanic),
        ]),
      ),
    [activeMechanics, entity],
  );
  const [values, setValues] =
    useState<Record<string, number | boolean>>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const stateValues = { ...entity.state.values };
    for (const mechanic of activeMechanics) {
      const value = values[mechanic.id];
      stateValues[mechanic.id] =
        mechanic.mode === "binary"
          ? { kind: "boolean", value: Boolean(value) }
          : { kind: "number", value: Number(value ?? 0) };
    }
    try {
      await api(worldPath(world.id, `entities/${entity.id}/state`), {
        method: "PUT",
        ...jsonBody({
          expected_revision: entity.state.revision,
          values: stateValues,
        }),
      });
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not save this sheet."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="entity-sheet" onSubmit={(event) => void save(event)}>
      <header>
        <span className="entity-portrait" aria-hidden="true">
          {entity.display_name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">Entity sheet</p>
          <h2>{entity.display_name}</h2>
          <span>state r{entity.state.revision}</span>
        </div>
      </header>
      {activeMechanics.length === 0 ? (
        <p className="sheet-empty">
          Configure a capacity or capability to generate this sheet.
        </p>
      ) : null}
      {(["capacity", "capability"] as const).map((kind) => {
        const group = activeMechanics.filter(
          (mechanic) => mechanic.kind === kind,
        );
        if (group.length === 0) return null;
        return (
          <section className="sheet-group" key={kind}>
            <h3>{kind === "capacity" ? "Capacities" : "Capabilities"}</h3>
            {group.map((mechanic) => (
              <label
                key={mechanic.id}
                className={`sheet-field sheet-${mechanic.mode}`}
              >
                <span>
                  <strong>{mechanic.name}</strong>
                  {mechanic.description === undefined ? null : (
                    <small>{mechanic.description}</small>
                  )}
                </span>
                {mechanic.mode === "binary" ? (
                  <input
                    type="checkbox"
                    checked={Boolean(values[mechanic.id])}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setValues((current) => ({
                        ...current,
                        [mechanic.id]: checked,
                      }));
                    }}
                    disabled={!editable}
                  />
                ) : (
                  <span className="sheet-number">
                    <input
                      type="number"
                      value={Number(values[mechanic.id] ?? 0)}
                      min={mechanic.minimum}
                      max={mechanic.maximum}
                      step={mechanic.step ?? "any"}
                      onChange={(event) => {
                        const value = event.currentTarget.valueAsNumber || 0;
                        setValues((current) => ({
                          ...current,
                          [mechanic.id]: value,
                        }));
                      }}
                      disabled={!editable}
                    />
                    <em>
                      {mechanic.mode === "pool" &&
                      mechanic.maximum !== undefined
                        ? `/ ${mechanic.maximum}`
                        : (mechanic.unit ?? "")}
                    </em>
                  </span>
                )}
              </label>
            ))}
          </section>
        );
      })}
      {error === null ? null : <ErrorMessage error={error} />}
      {editable && activeMechanics.length > 0 ? (
        <footer>
          <span>Direct setup edit</span>
          <button className="button button-ink" type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save sheet"}
          </button>
        </footer>
      ) : null}
    </form>
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
                    {mechanics.find(
                      (item) => item.id === effect.state_variable_id,
                    )?.kind === "capacity"
                      ? "◇"
                      : "✦"}
                  </i>
                  {entities.find((entity) => entity.id === effect.entity_id)
                    ?.display_name ?? "Entity"}
                  :{" "}
                  {mechanics.find(
                    (item) => item.id === effect.state_variable_id,
                  )?.name ?? "mechanic"}{" "}
                  {displayValue(effect.before)} → {displayValue(effect.after)}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

function effectToAPI(
  effect: EffectDraft,
  mechanics: WorldMechanic[],
): ConcreteEffect {
  const mechanic = mechanics.find((item) => item.id === effect.mechanicId);
  if (mechanic?.mode === "binary")
    return {
      id: effect.id,
      type: "set",
      entity_ids: [effect.entityId],
      state_variable_id: effect.mechanicId,
      value: { kind: "boolean", value: effect.booleanValue },
    };
  if (effect.operation === "set")
    return {
      id: effect.id,
      type: "set",
      entity_ids: [effect.entityId],
      state_variable_id: effect.mechanicId,
      value: { kind: "number", value: effect.amount },
    };
  return {
    id: effect.id,
    type: "adjust-number",
    entity_ids: [effect.entityId],
    state_variable_id: effect.mechanicId,
    amount: effect.amount,
  };
}

function effectDescription(
  effect: EffectDraft,
  mechanic?: WorldMechanic,
): string {
  if (mechanic === undefined) return "Unknown mechanic";
  if (mechanic.mode === "binary")
    return `${effect.booleanValue ? "Grant" : "Remove"} ${mechanic.name}`;
  return `${effect.operation === "set" ? "Set" : "Adjust"} ${mechanic.name} ${effect.operation === "adjust-number" && effect.amount >= 0 ? "+" : ""}${effect.amount}`;
}

function mechanicValue(
  value: StateValue | undefined,
  mechanic: WorldMechanic,
): number | boolean {
  if (Array.isArray(value) || value === undefined)
    return mechanic.mode === "binary" ? false : (mechanic.default_number ?? 0);
  if (value.kind === "boolean") return value.value;
  if (value.kind === "number") return value.value;
  return mechanic.mode === "binary" ? false : (mechanic.default_number ?? 0);
}

function displayValue(value?: StateValue): string {
  if (value === undefined) return "unknown";
  if (Array.isArray(value))
    return value.map((item) => displayScalar(item)).join(", ") || "empty";
  return displayScalar(value);
}

function displayScalar(value: StateScalarValue): string {
  switch (value.kind) {
    case "number":
      return String(value.value);
    case "boolean":
      return value.value ? "yes" : "no";
    case "text":
    case "choice":
      return value.value;
    case "measurement":
      return `${value.amount} ${value.unit}`;
    case "reference":
      return value.fallback_name ?? "entity";
  }
}

function entitySubtitle(
  entity: WorldEntity,
  mechanics: WorldMechanic[],
): string {
  const capacity = mechanics.find(
    (mechanic) => mechanic.kind === "capacity" && !mechanic.archived,
  );
  if (capacity === undefined) return "Sheet ready";
  return `${capacity.name} ${displayValue(entity.state.values[capacity.id])}`;
}
