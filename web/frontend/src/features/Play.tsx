import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import {
  api,
  ApiError,
  gamePath,
  jsonBody,
  playRuleSetPath,
  readSelectedUserId,
  selectUserId,
} from "../api/client";
import type {
  ConcreteAppliedEffect,
  ConcreteEffect,
  Entity,
  Game,
  GameMembership,
  GameMembershipStatus,
  GameRole,
  Interaction,
  InteractionAction,
  InteractionResolutionResult,
  StateValue,
  StateVariableDefinition,
  User,
} from "../api/types";
import { ConcreteEffectListEditor } from "../components/ConcreteEffectEditor";
import {
  CheckPicker,
  EmptyState,
  ErrorNotice,
  Field,
  LoadingRows,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";
import { useCollection } from "../hooks/useCollection";
import { useGameEvents } from "../hooks/useGameEvents";

const selectedGamePrefix = "dnd.selected-game";

const roleLabels: Record<GameRole, string> = {
  facilitator: "Dungeon Master",
  player: "Player",
  spectator: "Spectator",
};

export function Play({ ruleSetId }: { ruleSetId: string }) {
  const users = useCollection<User>("/api/users");
  const [selectedUser, setSelectedUser] = useState(readSelectedUserId);
  const [creatingUser, setCreatingUser] = useState(false);
  const activeUser =
    users.items.find((user) => user.id === selectedUser) ?? users.items[0];

  useEffect(() => {
    if (activeUser === undefined || activeUser.id === selectedUser) return;
    selectUserId(activeUser.id);
    setSelectedUser(activeUser.id);
  }, [activeUser, selectedUser]);

  function chooseUser(userId: string) {
    selectUserId(userId);
    setSelectedUser(userId);
  }

  return (
    <>
      <PageHeader
        eyebrow="Play"
        title="The live table"
        description="Present an improvised problem, hear what players attempt, then commit the Dungeon Master’s ruling to shared world state."
        actions={
          <div className="play-identity-controls">
            <label>
              <span>Local identity</span>
              <select
                aria-label="Local identity"
                value={activeUser?.id ?? ""}
                disabled={users.loading || users.items.length === 0}
                onChange={(event) => chooseUser(event.currentTarget.value)}
              >
                {users.items.length === 0 ? (
                  <option value="">No local users</option>
                ) : null}
                {users.items.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button-secondary"
              type="button"
              onClick={() => setCreatingUser(true)}
            >
              + Local user
            </button>
          </div>
        }
      />
      {users.loading ? <LoadingRows /> : null}
      {users.error === null ? null : (
        <ErrorNotice error={users.error} onRetry={users.reload} />
      )}
      {!users.loading && users.error === null && activeUser === undefined ? (
        <LocalUserForm
          onCreated={(user) => {
            users.replaceItem(user, (item) => item.id);
            chooseUser(user.id);
          }}
        />
      ) : null}
      {activeUser === undefined || selectedUser !== activeUser.id ? null : (
        <PlayTable
          key={`${ruleSetId}:${activeUser.id}`}
          ruleSetId={ruleSetId}
          user={activeUser}
          users={users.items}
        />
      )}
      {creatingUser ? (
        <Modal
          label="Create a local user"
          onClose={() => setCreatingUser(false)}
        >
          <LocalUserForm
            compact
            onCancel={() => setCreatingUser(false)}
            onCreated={(user) => {
              users.replaceItem(user, (item) => item.id);
              chooseUser(user.id);
              setCreatingUser(false);
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}

function Modal({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open === true) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      aria-label={label}
      className="dialog-backdrop"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function LocalUserForm({
  compact = false,
  onCreated,
  onCancel,
}: {
  compact?: boolean;
  onCreated: (user: User) => void;
  onCancel?: () => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const user = await api<User>("/api/users", {
        method: "POST",
        ...jsonBody({ display_name: displayName }),
      });
      onCreated(user);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this local user."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      className={compact ? "local-user-dialog" : "local-user-onboarding"}
      title={compact ? "Create a local user" : "Who is at the table?"}
      description="Local identities exercise the authentication seam in this trusted development build."
    >
      <form className="form-stack" onSubmit={(event) => void submit(event)}>
        <Field label="Display name" required>
          <input
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
          />
        </Field>
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error.message}
          </p>
        )}
        <div className="form-actions">
          {onCancel === undefined ? null : (
            <button
              className="button-secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
          )}
          <button disabled={saving || displayName.trim() === ""}>
            {saving ? "Creating…" : "Create user"}
          </button>
        </div>
      </form>
    </Panel>
  );
}

function PlayTable({
  ruleSetId,
  user,
  users,
}: {
  ruleSetId: string;
  user: User;
  users: User[];
}) {
  const games = useCollection<Game>("/api/games");
  const gameStorageKey = `${selectedGamePrefix}.${ruleSetId}.${user.id}`;
  const [selectedGameId, setSelectedGameId] = useState(
    () => localStorage.getItem(gameStorageKey) ?? "",
  );
  const [creatingGame, setCreatingGame] = useState(false);
  const ruleSetGames = games.items.filter(
    (game) => game.rule_set_id === ruleSetId,
  );
  const game =
    ruleSetGames.find((item) => item.id === selectedGameId) ?? ruleSetGames[0];
  const membership = game?.memberships.find(
    (item) => item.user_id === user.id && item.status === "active",
  );
  const entities = useCollection<Entity>(
    game === undefined ? null : gamePath(game.id, "entities"),
  );
  const variables = useCollection<StateVariableDefinition>(
    game === undefined ? null : gamePath(game.id, "state-variable-definitions"),
  );
  const availableEntities = useCollection<Entity>(
    game === undefined ||
      membership?.role !== "facilitator" ||
      game.status !== "active"
      ? null
      : gamePath(game.id, "available-entities"),
  );
  const setupEntities = useCollection<Entity>(
    game === undefined || creatingGame
      ? playRuleSetPath(ruleSetId, "available-entities")
      : null,
  );
  const interactions = useCollection<Interaction>(
    game === undefined ? null : gamePath(game.id, "interactions"),
  );
  const reloadGames = games.reload;
  const reloadInteractions = interactions.reload;
  const reloadEntities = entities.reload;
  const reloadVariables = variables.reload;
  const reloadAvailableEntities = availableEntities.reload;

  useEffect(() => {
    if (game === undefined || game.id === selectedGameId) return;
    setSelectedGameId(game.id);
    localStorage.setItem(gameStorageKey, game.id);
  }, [game, gameStorageKey, selectedGameId]);

  const refreshTable = useCallback(() => {
    reloadGames();
    reloadInteractions();
    reloadEntities();
    reloadVariables();
    reloadAvailableEntities();
  }, [
    reloadAvailableEntities,
    reloadEntities,
    reloadGames,
    reloadInteractions,
    reloadVariables,
  ]);
  useGameEvents(game?.id, refreshTable);

  const gameEntities = entities.items;

  if (games.loading && games.items.length === 0) return <LoadingRows />;
  if (games.error !== null && games.items.length === 0)
    return <ErrorNotice error={games.error} onRetry={games.reload} />;
  if (game === undefined)
    return (
      <>
        {setupEntities.error === null ? null : (
          <ErrorNotice
            error={setupEntities.error}
            onRetry={setupEntities.reload}
          />
        )}
        <EmptyState
          title="No game for this ruleset yet"
          description="Create a live table. You will become its first Dungeon Master and can invite the other local users."
          action={
            <button type="button" onClick={() => setCreatingGame(true)}>
              Create a game
            </button>
          }
        />
        {creatingGame ? (
          <GameForm
            ruleSetId={ruleSetId}
            entities={setupEntities.items}
            onCancel={() => setCreatingGame(false)}
            onCreated={(created) => {
              games.replaceItem(created, (item) => item.id);
              setSelectedGameId(created.id);
              localStorage.setItem(gameStorageKey, created.id);
              setCreatingGame(false);
            }}
          />
        ) : null}
      </>
    );

  return (
    <>
      {games.error === null ? null : (
        <ErrorNotice error={games.error} onRetry={games.reload} />
      )}
      {entities.error === null ? null : (
        <ErrorNotice error={entities.error} onRetry={entities.reload} />
      )}
      {variables.error === null ? null : (
        <ErrorNotice error={variables.error} onRetry={variables.reload} />
      )}
      {availableEntities.error === null ? null : (
        <ErrorNotice
          error={availableEntities.error}
          onRetry={availableEntities.reload}
        />
      )}
      {setupEntities.error === null ? null : (
        <ErrorNotice
          error={setupEntities.error}
          onRetry={setupEntities.reload}
        />
      )}
      <div className="play-layout" key={game.id}>
        <GameSidebar
          game={game}
          games={ruleSetGames}
          membership={membership}
          currentUser={user}
          users={users}
          allEntities={availableEntities.items}
          onSelectGame={(id) => {
            setSelectedGameId(id);
            localStorage.setItem(gameStorageKey, id);
          }}
          onCreateGame={() => setCreatingGame(true)}
          onGameChanged={(changed) => {
            games.replaceItem(changed, (item) => item.id);
            entities.reload();
            variables.reload();
            availableEntities.reload();
          }}
        />
        <div className="play-table">
          {game.status === "archived" ? (
            <div className="notice notice-warn">
              <div>
                <strong>This game is archived.</strong>
                <p>Its resolved interactions and receipts remain read-only.</p>
              </div>
            </div>
          ) : null}
          {interactions.error === null ? null : (
            <ErrorNotice
              error={interactions.error}
              onRetry={interactions.reload}
            />
          )}
          {membership?.role === "facilitator" && game.status === "active" ? (
            <InteractionComposer
              game={game}
              entities={gameEntities}
              onCreated={interactions.reload}
            />
          ) : null}
          {interactions.loading && interactions.items.length === 0 ? (
            <LoadingRows />
          ) : null}
          {!interactions.loading && interactions.items.length === 0 ? (
            <EmptyState
              title={
                membership?.role === "facilitator"
                  ? "Present the first problem"
                  : "The table is quiet"
              }
              description={
                membership?.role === "facilitator"
                  ? "Author the immediate situation here; it does not need a configured problem template."
                  : "A Dungeon Master has not presented an interaction yet."
              }
            />
          ) : (
            <div className="interaction-feed" aria-live="polite">
              {interactions.items.map((interaction) => (
                <InteractionCard
                  key={interaction.id}
                  interaction={interaction}
                  membership={membership}
                  currentUser={user}
                  users={users}
                  game={game}
                  entities={gameEntities}
                  variables={variables.items}
                  onChanged={interactions.reload}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {creatingGame ? (
        <GameForm
          ruleSetId={ruleSetId}
          entities={setupEntities.items}
          onCancel={() => setCreatingGame(false)}
          onCreated={(created) => {
            games.replaceItem(created, (item) => item.id);
            setSelectedGameId(created.id);
            localStorage.setItem(gameStorageKey, created.id);
            setCreatingGame(false);
          }}
        />
      ) : null}
    </>
  );
}

function GameForm({
  ruleSetId,
  entities,
  onCreated,
  onCancel,
}: {
  ruleSetId: string;
  entities: Entity[];
  onCreated: (game: Game) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const game = await api<Game>("/api/games", {
        method: "POST",
        ...jsonBody({ rule_set_id: ruleSetId, name, entity_ids: entityIds }),
      });
      onCreated(game);
    } catch (reason) {
      setError(
        reason instanceof ApiError
          ? reason
          : new ApiError(0, "unknown", "Could not create this game."),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal label="Create a game" onClose={onCancel}>
      <Panel
        className="game-dialog"
        title="Create a game"
        description="This live table uses the selected ruleset and an explicit set of world entities."
      >
        <form className="form-stack" onSubmit={(event) => void submit(event)}>
          <Field label="Game name" required>
            <input
              required
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </Field>
          <CheckPicker
            legend="Initial world entities"
            help="You can change this association from the Dungeon Master table later."
            options={entities
              .filter((entity) => !entity.archived)
              .map((entity) => ({
                id: entity.id,
                label: entity.display_name,
                description: entity.key,
              }))}
            selected={entityIds}
            onChange={setEntityIds}
            emptyLabel="Create ruleset entities in Build before associating a world."
          />
          {error === null ? null : (
            <p className="form-error" role="alert">
              {error.message}
            </p>
          )}
          <div className="form-actions">
            <button
              className="button-secondary"
              type="button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button disabled={saving || name.trim() === ""}>
              {saving ? "Creating…" : "Create game"}
            </button>
          </div>
        </form>
      </Panel>
    </Modal>
  );
}

function GameSidebar({
  game,
  games,
  membership,
  currentUser,
  users,
  allEntities,
  onSelectGame,
  onCreateGame,
  onGameChanged,
}: {
  game: Game;
  games: Game[];
  membership: GameMembership | undefined;
  currentUser: User;
  users: User[];
  allEntities: Entity[];
  onSelectGame: (id: string) => void;
  onCreateGame: () => void;
  onGameChanged: (game: Game) => void;
}) {
  const [addingUserId, setAddingUserId] = useState("");
  const [addingRole, setAddingRole] = useState<GameRole>("player");
  const [addingStatus, setAddingStatus] =
    useState<GameMembershipStatus>("active");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const facilitator = membership?.role === "facilitator";
  const canManage = facilitator && game.status === "active";
  const availableUsers = users.filter(
    (user) => !game.memberships.some((item) => item.user_id === user.id),
  );

  async function replaceEntities(entityIds: string[]) {
    setWorking(true);
    setError(null);
    try {
      const changed = await api<Game>(gamePath(game.id, "entities"), {
        method: "PUT",
        ...jsonBody({
          entity_ids: entityIds,
          expected_revision: game.revision,
        }),
      });
      onGameChanged(changed);
    } catch (reason) {
      setError(asApiError(reason, "Could not change the game world."));
    } finally {
      setWorking(false);
    }
  }

  async function addMembership() {
    if (addingUserId === "") return;
    setWorking(true);
    setError(null);
    try {
      const changed = await api<Game>(gamePath(game.id, "memberships"), {
        method: "POST",
        ...jsonBody({
          user_id: addingUserId,
          role: addingRole,
          status: addingStatus,
        }),
      });
      onGameChanged(changed);
      setAddingUserId("");
      setAddingRole("player");
      setAddingStatus("active");
    } catch (reason) {
      setError(asApiError(reason, "Could not add this participant."));
    } finally {
      setWorking(false);
    }
  }

  async function changeMembership(
    member: GameMembership,
    changes: { role?: GameRole; status?: GameMembershipStatus },
  ) {
    setWorking(true);
    setError(null);
    try {
      const changed = await api<Game>(
        gamePath(game.id, `memberships/${member.id}`),
        {
          method: "PATCH",
          ...jsonBody({ ...changes, expected_revision: member.revision }),
        },
      );
      onGameChanged(changed);
    } catch (reason) {
      setError(asApiError(reason, "Could not change this participant’s role."));
    } finally {
      setWorking(false);
    }
  }

  async function archiveGame() {
    if (
      !window.confirm(
        "Archive this game? Its resolved history will remain readable, but live play cannot resume.",
      )
    )
      return;
    setWorking(true);
    setError(null);
    try {
      const changed = await api<Game>(gamePath(game.id, "archive"), {
        method: "POST",
        ...jsonBody({ expected_revision: game.revision }),
      });
      onGameChanged(changed);
    } catch (reason) {
      setError(asApiError(reason, "Could not archive this game."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <aside className="play-sidebar">
      <Panel
        title="Table"
        actions={
          <div className="compact-actions">
            {canManage ? (
              <button
                className="button-secondary danger-text"
                type="button"
                disabled={working}
                onClick={() => void archiveGame()}
              >
                Archive
              </button>
            ) : null}
            <button
              className="button-secondary"
              type="button"
              onClick={onCreateGame}
            >
              + Game
            </button>
          </div>
        }
      >
        <Field label="Game">
          <select
            value={game.id}
            onChange={(event) => onSelectGame(event.currentTarget.value)}
          >
            {games.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.status === "archived" ? " (archived)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <div className="current-seat">
          <span>
            <small>Your seat</small>
            <strong>{currentUser.display_name}</strong>
          </span>
          <StatusBadge
            tone={membership?.role === "facilitator" ? "info" : "neutral"}
          >
            {membership === undefined
              ? "No membership"
              : roleLabels[membership.role]}
          </StatusBadge>
        </div>
        {membership === undefined ? (
          <div className="notice notice-warn">
            <div>
              <strong>This user is not at this table.</strong>
              <p>Switch to an invited local identity.</p>
            </div>
          </div>
        ) : null}
      </Panel>
      <Panel
        title="Roster"
        description="Real people and their table authority."
      >
        <div className="roster-list">
          {game.memberships.map((member) => (
            <div className="roster-row" key={member.id}>
              <span>
                <strong>{membershipName(member, users)}</strong>
                <small>{member.status}</small>
              </span>
              {canManage ? (
                <select
                  aria-label={`Role for ${membershipName(member, users)}`}
                  value={member.role}
                  disabled={working}
                  onChange={(event) =>
                    void changeMembership(member, {
                      role: event.currentTarget.value as GameRole,
                    })
                  }
                >
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              ) : (
                <StatusBadge>{roleLabels[member.role]}</StatusBadge>
              )}
              {canManage ? (
                <select
                  aria-label={`Status for ${membershipName(member, users)}`}
                  value={member.status}
                  disabled={working}
                  onChange={(event) =>
                    void changeMembership(member, {
                      status: event.currentTarget.value as GameMembershipStatus,
                    })
                  }
                >
                  <option value="invited">Invited</option>
                  <option value="active">Active</option>
                  <option value="left">Left</option>
                </select>
              ) : null}
            </div>
          ))}
        </div>
        {canManage && availableUsers.length > 0 ? (
          <div className="add-member-controls">
            <Field label="Add local user">
              <select
                value={addingUserId}
                onChange={(event) => setAddingUserId(event.currentTarget.value)}
              >
                <option value="">Choose a user</option>
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role">
              <select
                value={addingRole}
                onChange={(event) =>
                  setAddingRole(event.currentTarget.value as GameRole)
                }
              >
                {Object.entries(roleLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starting status">
              <select
                value={addingStatus}
                onChange={(event) =>
                  setAddingStatus(
                    event.currentTarget.value as GameMembershipStatus,
                  )
                }
              >
                <option value="active">Active now</option>
                <option value="invited">Invited</option>
              </select>
            </Field>
            <button
              type="button"
              disabled={working || addingUserId === ""}
              onClick={() => void addMembership()}
            >
              Add to table
            </button>
          </div>
        ) : null}
        {error === null ? null : <ErrorNotice error={error} />}
      </Panel>
      {canManage ? (
        <Panel
          title="World in play"
          description="Only associated entities may be targeted by live rulings."
        >
          <CheckPicker
            legend="Game entities"
            options={allEntities.map((entity) => ({
              id: entity.id,
              label: entity.display_name,
              description: entity.archived ? "Archived" : entity.key,
              disabled: entity.archived && !game.entity_ids.includes(entity.id),
            }))}
            selected={game.entity_ids}
            onChange={(ids) => void replaceEntities(ids)}
            emptyLabel="Create entities in Build before associating them here."
          />
        </Panel>
      ) : null}
    </aside>
  );
}

function InteractionComposer({
  game,
  entities,
  onCreated,
}: {
  game: Game;
  entities: Entity[];
  onCreated: () => void;
}) {
  const responders = game.memberships.filter(
    (member) => member.role === "player" && member.status === "active",
  );
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [entityIds, setEntityIds] = useState<string[]>([]);
  const [interactionId, setInteractionId] = useState(() => crypto.randomUUID());
  const [responderIds, setResponderIds] = useState<string[]>(() =>
    responders.map((member) => member.id),
  );
  const [working, setWorking] = useState<"draft" | "present" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const responderKey = responders.map((member) => member.id).join(":");
  useEffect(() => {
    const valid = new Set(responderKey === "" ? [] : responderKey.split(":"));
    setResponderIds((current) => current.filter((id) => valid.has(id)));
  }, [responderKey]);

  function resetComposer() {
    setTitle("");
    setPrompt("");
    setPrivateNotes("");
    setEntityIds([]);
    setResponderIds(responders.map((member) => member.id));
    setInteractionId(crypto.randomUUID());
    onCreated();
  }

  async function create(present: boolean) {
    if (prompt.trim() === "") return;
    setWorking(present ? "present" : "draft");
    setError(null);
    try {
      await api<Interaction>(gamePath(game.id, "interactions"), {
        method: "POST",
        ...jsonBody({
          id: interactionId,
          present,
          ...(title.trim() === "" ? {} : { title }),
          prompt,
          ...(privateNotes.trim() === ""
            ? {}
            : { private_notes: privateNotes }),
          audience_membership_ids: game.memberships
            .filter((member) => member.status === "active")
            .map((member) => member.id),
          entity_ids: entityIds,
          eligible_responder_membership_ids: responderIds,
        }),
      });
      resetComposer();
    } catch (reason) {
      try {
        await api<Interaction>(
          gamePath(game.id, `interactions/${interactionId}`),
        );
        resetComposer();
      } catch {
        setError(asApiError(reason, "Could not create this interaction."));
      }
    } finally {
      setWorking(null);
    }
  }

  return (
    <Panel
      className="interaction-composer"
      title="Present a problem"
      description="This moment belongs to the game, not the reusable problem library."
    >
      <div className="form-grid">
        <Field label="Title" hint="Optional label for the play feed.">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Field>
        <Field
          label="Relevant entities"
          hint="Optional context, not effect targets."
        >
          <select
            value=""
            onChange={(event) => {
              const id = event.currentTarget.value;
              if (id !== "" && !entityIds.includes(id))
                setEntityIds([...entityIds, id]);
            }}
          >
            <option value="">Add an entity</option>
            {entities
              .filter((entity) => !entityIds.includes(entity.id))
              .map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.display_name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {entityIds.length === 0 ? null : (
        <div className="entity-chip-row">
          {entityIds.map((id) => (
            <button
              className="entity-chip"
              type="button"
              key={id}
              onClick={() =>
                setEntityIds(entityIds.filter((item) => item !== id))
              }
            >
              {entities.find((entity) => entity.id === id)?.display_name ?? id}
              <span aria-hidden="true"> ×</span>
            </button>
          ))}
        </div>
      )}
      <Field label="What do the players encounter?" required>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.currentTarget.value)}
        />
      </Field>
      <Field label="Private Dungeon Master notes">
        <textarea
          value={privateNotes}
          onChange={(event) => setPrivateNotes(event.currentTarget.value)}
        />
      </Field>
      <CheckPicker
        legend="Eligible responders"
        help="Selected players may submit an action while this interaction is open."
        options={responders.map((member) => ({
          id: member.id,
          label: membershipName(member, []),
          description: "Player",
        }))}
        selected={responderIds}
        onChange={setResponderIds}
        emptyLabel="Add player memberships to invite responses."
      />
      {error === null ? null : <ErrorNotice error={error} />}
      <div className="form-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={working !== null || prompt.trim() === ""}
          onClick={() => void create(false)}
        >
          {working === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          disabled={working !== null || prompt.trim() === ""}
          onClick={() => void create(true)}
        >
          {working === "present" ? "Presenting…" : "Present now"}
        </button>
      </div>
    </Panel>
  );
}

function InteractionCard({
  interaction,
  membership,
  currentUser,
  users,
  game,
  entities,
  variables,
  onChanged,
}: {
  interaction: Interaction;
  membership: GameMembership | undefined;
  currentUser: User;
  users: User[];
  game: Game;
  entities: Entity[];
  variables: StateVariableDefinition[];
  onChanged: () => void;
}) {
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [editing, setEditing] = useState(false);
  const facilitator = membership?.role === "facilitator";
  const eligible =
    membership !== undefined &&
    interaction.eligible_responder_membership_ids.includes(membership.id);
  const activeAction = interaction.actions.find(
    (action) =>
      action.submitted_by_membership_id === membership?.id &&
      action.status === "submitted",
  );

  async function lifecycle(command: "present" | "adjudicate" | "cancel") {
    setWorking(command);
    setError(null);
    try {
      await api<Interaction>(
        gamePath(game.id, `interactions/${interaction.id}/${command}`),
        {
          method: "POST",
          ...jsonBody({ expected_revision: interaction.revision }),
        },
      );
      onChanged();
    } catch (reason) {
      setError(asApiError(reason, `Could not ${command} this interaction.`));
    } finally {
      setWorking(null);
    }
  }

  async function withdraw(action: InteractionAction) {
    setWorking(`withdraw-${action.id}`);
    setError(null);
    try {
      await api<InteractionAction>(
        gamePath(
          game.id,
          `interactions/${interaction.id}/actions/${action.id}/withdraw`,
        ),
        {
          method: "POST",
          ...jsonBody({ expected_revision: action.revision }),
        },
      );
      onChanged();
    } catch (reason) {
      setError(asApiError(reason, "Could not withdraw this action."));
    } finally {
      setWorking(null);
    }
  }

  return (
    <article className={`interaction-card interaction-${interaction.status}`}>
      <header className="interaction-head">
        <div>
          <p className="eyebrow">
            {interaction.title?.trim() === ""
              ? "Interaction"
              : (interaction.title ?? "Interaction")}
          </p>
          <h2>{interaction.prompt}</h2>
        </div>
        <StatusBadge tone={interactionTone(interaction.status)}>
          {interaction.status}
        </StatusBadge>
      </header>
      {interaction.entity_ids.length === 0 ? null : (
        <p className="interaction-context">
          Involving{" "}
          {interaction.entity_ids
            .map(
              (id) =>
                entities.find((entity) => entity.id === id)?.display_name ?? id,
            )
            .join(", ")}
        </p>
      )}
      {facilitator && interaction.private_notes !== undefined ? (
        <div className="private-note">
          <strong>Private notes</strong>
          <p>{interaction.private_notes}</p>
        </div>
      ) : null}
      {facilitator && interaction.status === "draft" && editing ? (
        <DraftInteractionEditor
          key={interaction.revision}
          interaction={interaction}
          game={game}
          entities={entities}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : null}
      {interaction.actions.length === 0 ? null : (
        <div className="submission-list">
          <h3>Player actions</h3>
          {interaction.actions.map((action) => (
            <div
              className={`submission-card submission-${action.status}`}
              key={action.id}
            >
              <div>
                <strong>{actionAuthor(action, game.memberships, users)}</strong>
                <p>{action.text}</p>
              </div>
              <div className="submission-meta">
                <StatusBadge>{action.status}</StatusBadge>
                {action.id === activeAction?.id &&
                interaction.status === "open" ? (
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={working !== null}
                    onClick={() => void withdraw(action)}
                  >
                    {working === `withdraw-${action.id}`
                      ? "Withdrawing…"
                      : "Withdraw"}
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
      {membership?.role === "player" &&
      interaction.status === "open" &&
      eligible &&
      activeAction === undefined ? (
        <ActionComposer
          interaction={interaction}
          game={game}
          onCreated={onChanged}
        />
      ) : null}
      {membership?.role === "player" &&
      interaction.status === "open" &&
      !eligible ? (
        <p className="quiet-note">
          {currentUser.display_name} is observing this interaction but is not an
          eligible responder.
        </p>
      ) : null}
      {facilitator && interaction.status === "adjudicating" ? (
        <AdjudicationComposer
          interaction={interaction}
          game={game}
          entities={entities}
          variables={variables}
          onResolved={onChanged}
        />
      ) : null}
      {interaction.status === "resolved" &&
      interaction.resolution !== undefined ? (
        <ResolutionReceipt
          interaction={interaction}
          entities={entities}
          variables={variables}
        />
      ) : null}
      {error === null ? null : <ErrorNotice error={error} />}
      {facilitator &&
      (interaction.status === "draft" ||
        interaction.status === "open" ||
        interaction.status === "adjudicating") ? (
        <div className="interaction-actions">
          {interaction.status === "draft" ? (
            <>
              <button
                className="button-secondary"
                type="button"
                disabled={working !== null}
                onClick={() => setEditing((value) => !value)}
              >
                {editing ? "Close editor" : "Edit draft"}
              </button>
              <button
                type="button"
                disabled={working !== null || editing}
                onClick={() => void lifecycle("present")}
              >
                {working === "present" ? "Presenting…" : "Present interaction"}
              </button>
            </>
          ) : interaction.status === "open" ? (
            <button
              type="button"
              disabled={working !== null}
              onClick={() => void lifecycle("adjudicate")}
            >
              {working === "adjudicate"
                ? "Closing…"
                : "Close submissions and adjudicate"}
            </button>
          ) : null}
          <button
            className="button-secondary danger-text"
            type="button"
            disabled={working !== null}
            onClick={() => void lifecycle("cancel")}
          >
            {working === "cancel" ? "Cancelling…" : "Cancel"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function DraftInteractionEditor({
  interaction,
  game,
  entities,
  onSaved,
  onCancel,
}: {
  interaction: Interaction;
  game: Game;
  entities: Entity[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const activeMembers = game.memberships.filter(
    (member) => member.status === "active",
  );
  const players = activeMembers.filter((member) => member.role === "player");
  const [title, setTitle] = useState(interaction.title ?? "");
  const [prompt, setPrompt] = useState(interaction.prompt);
  const [privateNotes, setPrivateNotes] = useState(
    interaction.private_notes ?? "",
  );
  const [audienceIds, setAudienceIds] = useState(
    interaction.audience_membership_ids,
  );
  const [responderIds, setResponderIds] = useState(
    interaction.eligible_responder_membership_ids,
  );
  const [entityIds, setEntityIds] = useState(interaction.entity_ids);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const activeMemberKey = activeMembers.map((member) => member.id).join(":");
  const playerKey = players.map((member) => member.id).join(":");

  useEffect(() => {
    const active = new Set(
      activeMemberKey === "" ? [] : activeMemberKey.split(":"),
    );
    const player = new Set(playerKey === "" ? [] : playerKey.split(":"));
    setAudienceIds((current) => current.filter((id) => active.has(id)));
    setResponderIds((current) =>
      current.filter((id) => active.has(id) && player.has(id)),
    );
  }, [activeMemberKey, playerKey]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<Interaction>(
        gamePath(game.id, `interactions/${interaction.id}`),
        {
          method: "PUT",
          ...jsonBody({
            id: interaction.id,
            expected_revision: interaction.revision,
            ...(title.trim() === "" ? {} : { title }),
            prompt,
            ...(privateNotes.trim() === ""
              ? {}
              : { private_notes: privateNotes }),
            audience_membership_ids: audienceIds,
            eligible_responder_membership_ids: responderIds,
            entity_ids: entityIds,
          }),
        },
      );
      onSaved();
    } catch (reason) {
      setError(asApiError(reason, "Could not save this draft."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="draft-interaction-editor form-stack"
      onSubmit={(event) => void save(event)}
    >
      <div className="form-grid">
        <Field label="Draft title">
          <input
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </Field>
        <Field label="Problem" required>
          <textarea
            required
            value={prompt}
            onChange={(event) => setPrompt(event.currentTarget.value)}
          />
        </Field>
      </div>
      <Field label="Private Dungeon Master notes">
        <textarea
          value={privateNotes}
          onChange={(event) => setPrivateNotes(event.currentTarget.value)}
        />
      </Field>
      <CheckPicker
        legend="Audience"
        help="Only selected active members receive this interaction after it is presented."
        options={activeMembers.map((member) => ({
          id: member.id,
          label: membershipName(member, []),
          description: roleLabels[member.role],
        }))}
        selected={audienceIds}
        onChange={(ids) => {
          setAudienceIds(ids);
          setResponderIds((current) =>
            current.filter((id) => ids.includes(id)),
          );
        }}
        emptyLabel="Add active participants before presenting this draft."
      />
      <CheckPicker
        legend="Eligible responders"
        options={players.map((member) => ({
          id: member.id,
          label: membershipName(member, []),
          description: "Player",
        }))}
        selected={responderIds}
        onChange={(ids) => {
          setResponderIds(ids);
          setAudienceIds((current) => [
            ...current,
            ...ids.filter((id) => !current.includes(id)),
          ]);
        }}
        emptyLabel="No active players can respond."
      />
      <CheckPicker
        legend="Relevant entities"
        options={entities.map((entity) => ({
          id: entity.id,
          label: entity.display_name,
          description: entity.archived ? "Archived" : entity.key,
          disabled: entity.archived && !entityIds.includes(entity.id),
        }))}
        selected={entityIds}
        onChange={setEntityIds}
        emptyLabel="This game has no associated entities."
      />
      {error === null ? null : <ErrorNotice error={error} />}
      <div className="form-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel edit
        </button>
        <button disabled={saving || prompt.trim() === ""}>
          {saving ? "Saving…" : "Save draft changes"}
        </button>
      </div>
    </form>
  );
}

function ActionComposer({
  interaction,
  game,
  onCreated,
}: {
  interaction: Interaction;
  game: Game;
  onCreated: () => void;
}) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api<InteractionAction>(
        gamePath(game.id, `interactions/${interaction.id}/actions`),
        {
          method: "POST",
          ...jsonBody({
            text,
            expected_revision: interaction.revision,
          }),
        },
      );
      setText("");
      onCreated();
    } catch (reason) {
      setError(asApiError(reason, "Could not submit this action."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="action-composer" onSubmit={(event) => void submit(event)}>
      <Field label="What do you do?" required>
        <textarea
          required
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
      </Field>
      {error === null ? null : <ErrorNotice error={error} />}
      <div className="form-actions">
        <button disabled={saving || text.trim() === ""}>
          {saving ? "Submitting…" : "Submit action"}
        </button>
      </div>
    </form>
  );
}

function AdjudicationComposer({
  interaction,
  game,
  entities,
  variables,
  onResolved,
}: {
  interaction: Interaction;
  game: Game;
  entities: Entity[];
  variables: StateVariableDefinition[];
  onResolved: () => void;
}) {
  const selectableActions = interaction.actions.filter(
    (action) => action.status === "submitted" || action.status === "selected",
  );
  const [selectedActionId, setSelectedActionId] = useState(
    () => selectableActions[0]?.id ?? "",
  );
  const [actionSummary, setActionSummary] = useState("");
  const [narrative, setNarrative] = useState("");
  const [privateNotes, setPrivateNotes] = useState("");
  const [effects, setEffects] = useState<ConcreteEffect[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [preview, setPreview] = useState<InteractionResolutionResult | null>(
    null,
  );
  const [working, setWorking] = useState<"preview" | "resolve" | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function adjudicate(resolve: boolean) {
    if (narrative.trim() === "") return;
    setWorking(resolve ? "resolve" : "preview");
    setError(null);
    try {
      const payload = {
        expected_revision: interaction.revision,
        ...(selectedActionId === ""
          ? {}
          : { selected_action_id: selectedActionId }),
        ...(actionSummary.trim() === ""
          ? {}
          : { action_summary: actionSummary }),
        narrative,
        ...(privateNotes.trim() === "" ? {} : { private_notes: privateNotes }),
        effects,
        idempotency_key: idempotencyKey,
      };
      const result = await api<InteractionResolutionResult>(
        gamePath(
          game.id,
          `interactions/${interaction.id}/${resolve ? "resolve" : "preview"}`,
        ),
        { method: "POST", ...jsonBody(payload) },
      );
      if (resolve) {
        setIdempotencyKey(crypto.randomUUID());
        onResolved();
      } else setPreview(result);
    } catch (reason) {
      setError(
        asApiError(
          reason,
          resolve
            ? "Could not commit this ruling."
            : "Could not preview this ruling.",
        ),
      );
    } finally {
      setWorking(null);
    }
  }

  return (
    <section className="adjudication-composer">
      <header>
        <p className="eyebrow">Dungeon Master ruling</p>
        <h3>Decide what happened</h3>
      </header>
      {selectableActions.length === 0 ? (
        <p className="quiet-note">
          No player submission is required. Summarize an off-screen or
          facilitator-authored action if useful.
        </p>
      ) : (
        <fieldset className="action-picker">
          <legend>Action being adjudicated</legend>
          <label
            aria-label="No single submission"
            className={selectedActionId === "" ? "action-selected" : ""}
          >
            <input
              type="radio"
              checked={selectedActionId === ""}
              onChange={() => setSelectedActionId("")}
            />
            <span>
              <strong>No single submission</strong>
              <small>Use a combined action summary.</small>
            </span>
          </label>
          {selectableActions.map((action) => (
            <label
              aria-label={`Select action: ${action.text}`}
              className={
                selectedActionId === action.id ? "action-selected" : ""
              }
              key={action.id}
            >
              <input
                type="radio"
                checked={selectedActionId === action.id}
                onChange={() => setSelectedActionId(action.id)}
              />
              <span>
                <strong>{action.submitted_by_name ?? "Player action"}</strong>
                <small>{action.text}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <Field
        label="Action summary"
        hint="Optional summary when combining or reframing submissions."
      >
        <textarea
          value={actionSummary}
          onChange={(event) => setActionSummary(event.currentTarget.value)}
        />
      </Field>
      <Field label="What happened?" required>
        <textarea
          required
          value={narrative}
          onChange={(event) => {
            setNarrative(event.currentTarget.value);
            setPreview(null);
          }}
        />
      </Field>
      <Field label="Private follow-up notes">
        <textarea
          value={privateNotes}
          onChange={(event) => setPrivateNotes(event.currentTarget.value)}
        />
      </Field>
      <div className="live-effects-section">
        <h3>Mechanical consequences</h3>
        <p>
          Effects name concrete entities in this game and commit atomically with
          the narrative ruling.
        </p>
        <ConcreteEffectListEditor
          effects={effects}
          entities={entities}
          variables={variables}
          onChange={(next) => {
            setEffects(next);
            setPreview(null);
          }}
        />
      </div>
      {preview === null ? null : (
        <TransitionPreview
          result={preview}
          entities={entities}
          variables={variables}
        />
      )}
      {error === null ? null : <ErrorNotice error={error} />}
      <div className="form-actions">
        <button
          className="button-secondary"
          type="button"
          disabled={working !== null || narrative.trim() === ""}
          onClick={() => void adjudicate(false)}
        >
          {working === "preview" ? "Previewing…" : "Preview ruling"}
        </button>
        <button
          type="button"
          disabled={working !== null || narrative.trim() === ""}
          onClick={() => void adjudicate(true)}
        >
          {working === "resolve" ? "Resolving…" : "Resolve and publish"}
        </button>
      </div>
    </section>
  );
}

function TransitionPreview({
  result,
  entities,
  variables,
}: {
  result: InteractionResolutionResult;
  entities: Entity[];
  variables: StateVariableDefinition[];
}) {
  return (
    <div className="transition-preview">
      <div className="notice notice-warn">
        <div>
          <strong>Advisory preview</strong>
          <p>State may change before the ruling is committed.</p>
        </div>
      </div>
      <AppliedEffects
        effects={result.applied_effects}
        entities={entities}
        variables={variables}
      />
    </div>
  );
}

function ResolutionReceipt({
  interaction,
  entities,
  variables,
}: {
  interaction: Interaction;
  entities: Entity[];
  variables: StateVariableDefinition[];
}) {
  const resolution = interaction.resolution;
  if (resolution === undefined) return null;
  return (
    <section className="resolution-receipt">
      <header>
        <div>
          <p className="eyebrow">Ruling</p>
          <h3>{resolution.narrative}</h3>
        </div>
        <StatusBadge tone="good">Committed</StatusBadge>
      </header>
      {resolution.action_summary === undefined ? null : (
        <p className="action-summary">
          <strong>Action:</strong> {resolution.action_summary}
        </p>
      )}
      {resolution.private_notes === undefined ? null : (
        <div className="private-note">
          <strong>Private follow-up notes</strong>
          <p>{resolution.private_notes}</p>
        </div>
      )}
      <AppliedEffects
        effects={resolution.applied_effects}
        entities={entities}
        variables={variables}
      />
      {resolution.applied_effects.length === 0 ? (
        <p className="quiet-note">This was a narrative-only ruling.</p>
      ) : null}
      {resolution.resolved_at === undefined ? null : (
        <small className="receipt-time">
          Resolved {formatTimestamp(resolution.resolved_at)}
        </small>
      )}
    </section>
  );
}

function AppliedEffects({
  effects,
  entities,
  variables,
}: {
  effects: ConcreteAppliedEffect[];
  entities: Entity[];
  variables: StateVariableDefinition[];
}) {
  if (effects.length === 0) return null;
  return (
    <div className="effect-results">
      {effects.map((effect, index) => (
        <div
          className="effect-result"
          key={`${effect.effect_id}-${effect.entity_id}-${index}`}
        >
          <span className="effect-index">{index + 1}</span>
          <div>
            <strong>{effect.changed ? "State changed" : "No-op"}</strong>
            <p>
              {entities.find((entity) => entity.id === effect.entity_id)
                ?.display_name ?? effect.entity_id}
              {" · "}
              {variables.find(
                (variable) => variable.id === effect.state_variable_id,
              )?.label ?? effect.state_variable_id}
            </p>
            <div className="before-after">
              <PlayValueSnapshot label="Before" value={effect.before} />
              <span aria-hidden="true">→</span>
              <PlayValueSnapshot label="After" value={effect.after} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlayValueSnapshot({
  label,
  value,
}: {
  label: string;
  value: StateValue | undefined;
}) {
  return (
    <span>
      <small>{label}</small>
      <code>{value === undefined ? "unknown" : JSON.stringify(value)}</code>
    </span>
  );
}

function membershipName(member: GameMembership, users: User[]): string {
  return (
    member.display_name ??
    member.user?.display_name ??
    users.find((user) => user.id === member.user_id)?.display_name ??
    member.user_id
  );
}

function actionAuthor(
  action: InteractionAction,
  memberships: GameMembership[],
  users: User[],
): string {
  if (action.submitted_by_name !== undefined) return action.submitted_by_name;
  const member = memberships.find(
    (item) => item.id === action.submitted_by_membership_id,
  );
  return member === undefined ? "Player" : membershipName(member, users);
}

function interactionTone(status: Interaction["status"]) {
  switch (status) {
    case "open":
      return "good" as const;
    case "adjudicating":
      return "warn" as const;
    case "resolved":
      return "info" as const;
    case "cancelled":
      return "bad" as const;
    case "draft":
      return "neutral" as const;
  }
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function asApiError(reason: unknown, fallback: string): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError(0, "unknown", fallback);
}
