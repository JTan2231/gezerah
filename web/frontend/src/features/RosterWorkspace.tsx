import { useCallback, useState } from "react";

import { gamePath, worldPath } from "../api/client";
import type {
  Game,
  User,
  World,
  WorldEntity,
  WorldMechanic,
  WorldMember,
} from "../api/types";
import {
  EmptyState,
  ErrorMessage,
  LoadingState,
  PageIntro,
} from "../components/StudioUI";
import { useCollection } from "../hooks/useCollection";
import { useResource } from "../hooks/useResource";
import { EntityDetail } from "./EntityDetail";
import { ManageControllersModal, NewEntityModal } from "./RosterModals";

export function RosterWorkspace({
  world,
  user,
  onWorldChanged,
}: {
  world: World;
  user: User;
  onWorldChanged: () => void;
}) {
  const game = useResource<Game>(gamePath(world.primary_game_id));
  const entities = useCollection<WorldEntity>(worldPath(world.id, "entities"));
  const mechanics = useCollection<WorldMechanic>(
    worldPath(world.id, "mechanics"),
  );
  const members = useCollection<WorldMember>(worldPath(world.id, "members"));
  const [addingEntity, setAddingEntity] = useState(false);
  const [managingControllersFor, setManagingControllersFor] = useState<
    string | undefined
  >();
  const [selectedEntityId, setSelectedEntityId] = useState<
    string | undefined
  >();
  const [profileRefreshToken, setProfileRefreshToken] = useState(0);
  const activeEntities = entities.items.filter((entity) => !entity.archived);
  const selectedEntity =
    activeEntities.find((entity) => entity.id === selectedEntityId) ??
    activeEntities[0];

  const reloadGame = game.reload;
  const reloadEntities = entities.reload;
  const reloadMembers = members.reload;
  const refresh = useCallback(() => {
    reloadGame();
    reloadEntities();
    reloadMembers();
    onWorldChanged();
    setProfileRefreshToken((value) => value + 1);
  }, [onWorldChanged, reloadEntities, reloadGame, reloadMembers]);

  if (game.loading && game.value === null)
    return <LoadingState label="Preparing the roster" />;
  if (game.error !== null)
    return <ErrorMessage error={game.error} onRetry={game.reload} />;
  if (game.value === null) return null;
  if (
    (entities.loading && entities.items.length === 0) ||
    (mechanics.loading && mechanics.items.length === 0) ||
    (members.loading && members.items.length === 0)
  )
    return <LoadingState label="Preparing the roster" />;
  const loadedGame = game.value;

  const currentMembership = loadedGame.memberships.find(
    (membership) =>
      membership.user_id === user.id && membership.status === "active",
  );
  const firstError = entities.error ?? mechanics.error ?? members.error;

  return (
    <section className="roster-workspace content-narrow">
      <PageIntro
        eyebrow="Table preparation"
        title="Roster & sheets"
        description="Create ordinary world entities, assign player control, complete profiles, and make direct setup edits before entering Play."
        actions={
          world.status === "active" ? (
            <button
              className="button button-primary"
              type="button"
              onClick={() => setAddingEntity(true)}
            >
              <span aria-hidden="true">＋</span> Create entity
            </button>
          ) : undefined
        }
      />

      {entities.loading && entities.items.length === 0 ? (
        <LoadingState label="Loading roster" />
      ) : null}
      {firstError === null ? null : (
        <ErrorMessage error={firstError} onRetry={refresh} />
      )}

      {!entities.loading &&
      firstError === null &&
      activeEntities.length === 0 ? (
        <div className="panel roster-builder-empty">
          <EmptyState
            symbol="○"
            title="No one is in this world yet"
            description="Create an entity and its sheet will be generated from every active capacity and capability."
            action={
              world.status === "active" ? (
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => setAddingEntity(true)}
                >
                  Create the first entity
                </button>
              ) : undefined
            }
          />
        </div>
      ) : null}

      {activeEntities.length > 0 ? (
        <div className="roster-builder-grid">
          <aside className="panel roster-builder-catalog">
            <header>
              <div>
                <p className="eyebrow">World entities</p>
                <h2>Prepared for the table</h2>
              </div>
              <span>{activeEntities.length}</span>
            </header>
            <div className="roster-builder-list">
              {activeEntities.map((entity) => (
                <button
                  className={entity.id === selectedEntity?.id ? "active" : ""}
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
                      {rosterSubtitle(
                        entity,
                        loadedGame.memberships,
                        currentMembership?.id ?? "",
                      )}
                    </small>
                  </span>
                  <b aria-hidden="true">›</b>
                </button>
              ))}
            </div>
          </aside>

          <div className="builder-entity-detail">
            {selectedEntity === undefined ? null : (
              <EntityDetail
                key={`${selectedEntity.id}:${selectedEntity.state.revision}:${mechanics.items.map((mechanic) => mechanic.id).join(":")}`}
                entity={selectedEntity}
                mechanics={mechanics.items}
                mechanicsEditable={world.status === "active"}
                controlledByCurrentMember={false}
                facilitator
                world={world}
                profileRefreshToken={profileRefreshToken}
                onManageControllers={() =>
                  setManagingControllersFor(selectedEntity.id)
                }
                onProfileChanged={refresh}
                onSaved={refresh}
              />
            )}
          </div>
        </div>
      ) : null}

      {addingEntity ? (
        <NewEntityModal
          world={world}
          members={members.items}
          onClose={() => setAddingEntity(false)}
          onCreated={(entity) => {
            entities.replaceItem(entity, (item) => item.id);
            setSelectedEntityId(entity.id);
            setAddingEntity(false);
            refresh();
          }}
        />
      ) : null}
      {managingControllersFor === undefined ? null : (
        <ManageControllersModal
          world={world}
          game={loadedGame}
          entity={entities.items.find(
            (entity) => entity.id === managingControllersFor,
          )}
          members={members.items}
          onClose={() => setManagingControllersFor(undefined)}
          onSaved={() => {
            setManagingControllersFor(undefined);
            refresh();
          }}
        />
      )}
    </section>
  );
}

function rosterSubtitle(
  entity: WorldEntity,
  memberships: Game["memberships"],
  currentMembershipID: string,
): string {
  const controllers = memberships.filter(
    (membership) =>
      membership.status === "active" &&
      membership.role === "player" &&
      membership.controlled_entity_ids.includes(entity.id),
  );
  if (controllers.length === 0) return "Uncontrolled entity";
  const readiness =
    entity.character_status === "ready"
      ? "Ready"
      : `Setup ${entity.completed_field_count}/${entity.required_field_count}`;
  const names = controllers
    .map((membership) =>
      membership.id === currentMembershipID
        ? "You"
        : (membership.display_name ??
          membership.user?.display_name ??
          "Player"),
    )
    .join(", ");
  return `${readiness} · ${names}`;
}
